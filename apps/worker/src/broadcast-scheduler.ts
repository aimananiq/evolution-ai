import type { Queue } from "bullmq";
import { prisma } from "@evo/db";
import { isWithinSchedule, type ScheduleConfig } from "@evo/schedule";
import { remainingBulkToday } from "@evo/send";
import { emitWebhook } from "@evo/webhooks";
import { renderTemplate } from "@evo/inbound-templating";

const BATCH_SIZE = 50;
// How far ahead we pre-schedule delayed send jobs in a single tick. Bounds how
// many delayed jobs sit in Redis at once; later ticks top the pipeline back up.
const SCHEDULE_HORIZON_MS = 10 * 60 * 1000;

export function computeSendDelayMs(
  b: { intervalMinSec: number | null; intervalMaxSec: number | null; jitterMinMs: number; jitterMaxMs: number },
  rnd: () => number = Math.random,
): number {
  if (b.intervalMinSec != null && b.intervalMaxSec != null) {
    const min = b.intervalMinSec * 1000;
    const max = b.intervalMaxSec * 1000;
    return Math.floor(min + rnd() * Math.max(0, max - min));
  }
  return Math.floor(b.jitterMinMs + rnd() * Math.max(0, b.jitterMaxMs - b.jitterMinMs));
}

export async function runScheduler(sendQueue: Queue, opts?: { now?: Date }): Promise<{ enqueued: number }> {
  const now = opts?.now ?? new Date();

  await prisma.broadcast.updateMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    data: { status: "running", startedAt: now },
  });

  const broadcasts = await prisma.broadcast.findMany({
    where: { status: "running" },
    include: { template: true },
    take: 50,
  });
  let enqueued = 0;

  for (const b of broadcasts) {
    // Defer to the next window if outside the broadcast's schedule.
    if (!isWithinSchedule((b.scheduleJson as ScheduleConfig | null) ?? null, now)) continue;

    if (b.instanceGroupId) {
      const enq = await runGroupTick(sendQueue, b, now);
      enqueued += enq;
      continue;
    }

    // Failover: if the active number is offline (banned/disconnected), switch to the next connected backup.
    // One query for the active + all fallbacks; pick the first fallback that's open (in order).
    const relevant = await prisma.instance.findMany({
      where: { id: { in: [b.instanceId, ...(b.fallbackInstanceIds ?? [])] } },
      select: { id: true, connectionState: true },
    });
    const stateById = new Map(relevant.map((i) => [i.id, i.connectionState]));
    if (stateById.get(b.instanceId) !== "open") {
      const healthy = (b.fallbackInstanceIds ?? []).find((fid) => stateById.get(fid) === "open") ?? null;
      if (!healthy) continue; // no healthy number — defer until one comes back
      // Reset the pacing cursor to now so salvaged messages resume promptly on the
      // backup number rather than waiting behind the dead number's future cursor.
      await prisma.broadcast.update({ where: { id: b.id }, data: { instanceId: healthy, nextSlotAt: now } });
      // salvage: re-queue what failed / was in-flight on the dead number
      await prisma.broadcastTarget.updateMany({ where: { broadcastId: b.id, status: { in: ["failed", "sending"] } }, data: { status: "queued", error: null } });
      b.instanceId = healthy; // use the new number for the rest of this tick
      b.nextSlotAt = now;
    }

    // Respect the instance's warm-up ramp: only enqueue up to today's remaining allowance.
    const allowance = await remainingBulkToday(b.instanceId, now);
    if (allowance !== null && allowance <= 0) continue; // ramp exhausted today; defer
    const take = allowance === null ? BATCH_SIZE : Math.min(BATCH_SIZE, allowance);

    const targets = await prisma.broadcastTarget.findMany({
      where: { broadcastId: b.id, status: "queued" },
      take,
      include: { contact: true },
    });
    if (targets.length === 0) {
      await maybeCompleteBroadcast(b, now);
      continue;
    }
    const template = b.template?.body ?? "";
    // Stagger sends CUMULATIVELY: each message goes out at (previous slot + gap),
    // not at an independent random delay from now. The cursor persists on the
    // broadcast so spacing continues correctly across 30s ticks without bunching.
    const nowMs = now.getTime();
    let cursorMs = Math.max(nowMs, b.nextSlotAt ? b.nextSlotAt.getTime() : 0);
    let scheduledAny = false;
    for (const target of targets) {
      const gapMs = computeSendDelayMs(b as any);
      const slotMs = cursorMs + gapMs;
      // Don't schedule beyond the horizon this tick — leave the rest queued for a
      // later tick (keeps Redis delayed-job count bounded on huge broadcasts).
      if (slotMs - nowMs > SCHEDULE_HORIZON_MS) break;
      cursorMs = slotMs;
      scheduledAny = true;

      const c = target.contact;
      const cf = (c.customFields ?? {}) as Record<string, unknown>;
      const payload = {
        name: c.name ?? "",
        phone: c.phoneE164,
        contact: { name: c.name ?? "", phone: c.phoneE164 }, // support {{contact.name}} too
        ...cf, // support {{Program Code}} etc.
      };
      const text = renderTemplate(template, payload);
      await prisma.broadcastTarget.update({ where: { id: target.id }, data: { status: "sending" } });
      await sendQueue.add(
        "send",
        { broadcastId: b.id, targetId: target.id, instanceId: b.instanceId, to: c.phoneE164, text, mediaAssetId: b.mediaAssetId, workspaceId: b.workspaceId },
        { delay: slotMs - nowMs, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
      );
      enqueued += 1;
    }
    if (scheduledAny) {
      await prisma.broadcast.update({ where: { id: b.id }, data: { nextSlotAt: new Date(cursorMs) } });
    }
  }
  return { enqueued };
}

async function maybeCompleteBroadcast(b: { id: string; name: string; workspaceId: string }, now: Date): Promise<void> {
  const sendingCount = await prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "sending" } });
  if (sendingCount !== 0) return;
  await prisma.broadcast.update({ where: { id: b.id }, data: { status: "completed", completedAt: new Date() } });
  const [sent, failed, total] = await Promise.all([
    prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "sent" } }),
    prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "failed" } }),
    prisma.broadcastTarget.count({ where: { broadcastId: b.id } }),
  ]);
  const summary = { broadcastId: b.id, name: b.name, sent, failed, total };
  await emitWebhook(b.workspaceId, "broadcast.completed", summary);
  if (failed > 0) await emitWebhook(b.workspaceId, "broadcast.failed", summary);
}

type GroupState = { cursors: Record<string, number>; activeInstanceId: string | null; sentInCycle: number };

async function runGroupTick(
  sendQueue: Queue,
  b: any, // the running broadcast row (includes template)
  now: Date,
): Promise<number> {
  const nowMs = now.getTime();

  // Eligible = group members that are connected AND have ramp allowance left today.
  const memberIds = (
    await prisma.instanceGroupMember.findMany({ where: { groupId: b.instanceGroupId }, select: { instanceId: true } })
  ).map((m) => m.instanceId);
  if (memberIds.length === 0) return 0;

  const instances = await prisma.instance.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, connectionState: true, deliveryStatus: true },
  });
  // Preserve membership order for deterministic rotation.
  const byId = new Map(instances.map((i) => [i.id, i]));
  const orderedOpen: { id: string; connectionState: string; deliveryStatus: string }[] = [];
  for (const id of memberIds) {
    const inst = byId.get(id);
    if (inst && inst.connectionState === "open" && inst.deliveryStatus !== "delivery_failing" && inst.deliveryStatus !== "send_failing") orderedOpen.push(inst);
  }

  const allowance = new Map<string, number | null>();
  for (const inst of orderedOpen) allowance.set(inst.id, await remainingBulkToday(inst.id, now));
  const eligible = orderedOpen.filter((i) => allowance.get(i.id) !== 0); // null = unlimited; 0 = exhausted
  const eligibleIds = new Set(eligible.map((i) => i.id));

  // Snapshot the targets that were already queued BEFORE failover, so a target
  // salvaged off a dead number this tick waits for the next tick rather than being
  // immediately re-sent on a surviving number.
  const preQueuedIds = new Set(
    (await prisma.broadcastTarget.findMany({ where: { broadcastId: b.id, status: "queued" }, select: { id: true } })).map((t) => t.id),
  );

  // Group failover: re-queue any in-flight target whose number is no longer eligible.
  await prisma.broadcastTarget.updateMany({
    where: { broadcastId: b.id, status: "sending", instanceId: { notIn: [...eligibleIds] } },
    data: { status: "queued", error: null, instanceId: null },
  });

  if (eligible.length === 0) return 0; // all numbers down/exhausted — defer this tick

  const queuedNow = await prisma.broadcastTarget.findMany({
    where: { broadcastId: b.id, status: "queued" },
    take: BATCH_SIZE,
    include: { contact: true },
  });
  if (queuedNow.length === 0) {
    await maybeCompleteBroadcast(b, now); // same completion logic single mode uses
    return 0;
  }
  // Don't re-send targets salvaged off a dead number this same tick — let them
  // settle to the next tick so failover is observable as a re-queue.
  const targets = queuedNow.filter((t) => preQueuedIds.has(t.id));
  if (targets.length === 0) return 0;

  const template = b.template?.body ?? "";
  const state: GroupState = (b.groupState as GroupState | null) ?? { cursors: {}, activeInstanceId: null, sentInCycle: 0 };
  const rotateEvery = Math.max(1, b.rotateEvery ?? 20);
  // Local per-instance allowance budget for this tick (don't over-assign to one number).
  const budget = new Map<string, number>();
  for (const i of eligible) { const a = allowance.get(i.id); budget.set(i.id, a == null ? Number.MAX_SAFE_INTEGER : a); }

  // Ensure a valid rotate pointer within the eligible set.
  if (b.groupSendMode === "rotate" && (!state.activeInstanceId || !eligibleIds.has(state.activeInstanceId))) {
    state.activeInstanceId = eligible[0]!.id;
    state.sentInCycle = 0;
  }

  let enqueued = 0;
  for (const target of targets) {
    // Pick the instance for this lead.
    let instId: string | null = null;
    if (b.groupSendMode === "rotate") {
      // Hop the pointer forward past a completed cycle or an out-of-budget number,
      // at most once around the ring; if nothing has budget, instId stays null.
      for (let hop = 0; hop < eligible.length; hop++) {
        const active = state.activeInstanceId!;
        const cycleDone = state.sentInCycle >= rotateEvery;
        const noBudget = (budget.get(active) ?? 0) <= 0;
        if (cycleDone || noBudget) {
          const idx = eligible.findIndex((i) => i.id === active);
          state.activeInstanceId = eligible[(idx + 1) % eligible.length]!.id;
          state.sentInCycle = 0;
          continue;
        }
        instId = active;
        break;
      }
    } else {
      // parallel: the eligible number that is free soonest and still has budget.
      const candidates = eligible.filter((i) => (budget.get(i.id) ?? 0) > 0);
      if (candidates.length > 0) {
        candidates.sort((a, c) => (state.cursors[a.id] ?? 0) - (state.cursors[c.id] ?? 0));
        instId = candidates[0]!.id;
      }
    }
    if (!instId) break; // every eligible number is out of budget this tick

    const gapMs = computeSendDelayMs(b);
    const baseMs = Math.max(nowMs, state.cursors[instId] ?? 0);
    const slotMs = baseMs + gapMs;
    if (slotMs - nowMs > SCHEDULE_HORIZON_MS) break;
    state.cursors[instId] = slotMs;
    budget.set(instId, (budget.get(instId) ?? 0) - 1);
    if (b.groupSendMode === "rotate") state.sentInCycle += 1;

    const c = target.contact;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const text = renderTemplate(template, { name: c.name ?? "", phone: c.phoneE164, contact: { name: c.name ?? "", phone: c.phoneE164 }, ...cf });
    await prisma.broadcastTarget.update({ where: { id: target.id }, data: { status: "sending", instanceId: instId } });
    await sendQueue.add(
      "send",
      { broadcastId: b.id, targetId: target.id, instanceId: instId, to: c.phoneE164, text, mediaAssetId: b.mediaAssetId, workspaceId: b.workspaceId },
      { delay: slotMs - nowMs, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    enqueued += 1;
  }

  await prisma.broadcast.update({ where: { id: b.id }, data: { groupState: state as any } });
  return enqueued;
}
