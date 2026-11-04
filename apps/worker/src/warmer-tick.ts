import type { Queue } from "bullmq";
import { prisma } from "@evo/db";
import {
  nextMove,
  decideConversation,
  planConversation,
  dailyQuota,
  runDayIndex,
  type WarmerConfig,
} from "@evo/warmer-engine";
import { resolveAiConfig, toWarmerCredentials, generateWarmerConversation } from "@evo/ai";

async function enqueueSend(
  sendQueue: Queue,
  run: { id: string; workspaceId: string },
  s: { instanceId: string; to: string; text: string; typingDelayMs: number; scheduledDelayMs: number },
) {
  await sendQueue.add(
    "send",
    { runId: run.id, workspaceId: run.workspaceId, instanceId: s.instanceId, to: s.to, text: s.text, typingDelayMs: s.typingDelayMs },
    { delay: s.scheduledDelayMs, attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
  );
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Record WHY a running profile produced nothing, so a misconfigured warmer shows
 * a clear reason in the live log instead of silently doing nothing. Throttled to
 * one event per reason per run per 30 min so healthy-but-idle ticks don't spam.
 */
async function noteIdle(
  run: { id: string; workspaceId: string },
  reason: string,
  message: string,
  instanceId?: string | null,
): Promise<void> {
  const since = new Date(Date.now() - 30 * 60_000);
  const existing = await prisma.warmerEvent.findFirst({
    where: { runId: run.id, kind: "info", createdAt: { gte: since }, detail: { path: ["idleReason"], equals: reason } },
    select: { id: true },
  });
  if (existing) return;
  await prisma.warmerEvent.create({
    data: { workspaceId: run.workspaceId, runId: run.id, instanceId: instanceId ?? null, kind: "info", detail: { status: "idle", idleReason: reason, message } } as any,
  });
}

/**
 * Ramp context for a run: the per-number daily message quota (climbs as the run
 * ages) and how many each number has already sent today. `remaining(id)` is the
 * ban-safety governor — a number stops warming once it hits its ramped quota.
 */
async function rampContext(run: { id: string; startedAt: Date }, config: WarmerConfig, now: Date) {
  if (!config.ramp) return { remaining: () => Number.POSITIVE_INFINITY };
  const quota = dailyQuota(config.ramp, runDayIndex(new Date(run.startedAt), now));
  const grouped = await prisma.warmerEvent.groupBy({
    by: ["instanceId"],
    where: { runId: run.id, kind: "send", createdAt: { gte: startOfUtcDay(now) }, instanceId: { not: null } },
    _count: { _all: true },
  });
  const sent = new Map<string, number>();
  for (const g of grouped) if (g.instanceId) sent.set(g.instanceId, g._count._all);
  return { remaining: (id: string) => quota - (sent.get(id) ?? 0) };
}

/**
 * Attempt an AI-generated conversation for one run. Returns sends enqueued (>= 0)
 * when AI handled this tick, or `null` when AI is unavailable so the caller falls
 * back to the static template warmer.
 */
async function runAiConversation(
  sendQueue: Queue,
  run: { id: string; workspaceId: string },
  config: WarmerConfig,
  now: Date,
  remaining: (instanceId: string) => number,
): Promise<number | null> {
  const ai = config.ai;
  if (!ai?.enabled) return null;

  const cap = ai.maxConversationsPerDay ?? 20;
  const usedToday = await prisma.warmerEvent.count({
    where: {
      workspaceId: run.workspaceId,
      kind: "info",
      detail: { path: ["aiConversation"], equals: true },
      createdAt: { gte: startOfUtcDay(now) },
    },
  });
  if (usedToday >= cap) return 0;

  const decision = decideConversation({ config, now });
  if (!decision) return 0;

  // Ramp gate: don't start a conversation if the primary number is at its quota.
  if (remaining(decision.instanceId) <= 0) return 0;

  const cred = toWarmerCredentials(await resolveAiConfig(run.workspaceId, "warmer"));
  if (!cred) {
    await noteIdle(
      run,
      "ai_no_credentials",
      "AI warming is enabled but no AI credentials are configured for this workspace. Add an Ollama or Claude key under Settings → Integrations → AI. Falling back to static templates meanwhile.",
      decision.instanceId,
    );
    return null;
  }

  const ids = [decision.instanceId, decision.partnerInstanceId].filter(Boolean) as string[];
  const insts = await prisma.instance.findMany({
    where: { id: { in: ids } },
    select: { id: true, phoneNumber: true, profileName: true },
  });
  const byId = new Map(insts.map((i) => [i.id, i]));
  const senderNumber = byId.get(decision.instanceId)?.phoneNumber ?? undefined;
  const partnerNumber =
    decision.partnerNumber ??
    (decision.partnerInstanceId ? byId.get(decision.partnerInstanceId)?.phoneNumber ?? undefined : undefined);
  if (!partnerNumber) return null;
  if (decision.partnerInstanceId && !senderNumber) return null;

  const nameA = byId.get(decision.instanceId)?.profileName || "A";
  const nameB = decision.partnerInstanceId
    ? byId.get(decision.partnerInstanceId)?.profileName || "B"
    : config.outboundPartners?.find((p) => p.number === decision.partnerNumber)?.label || "B";

  let lines: string[];
  try {
    lines = await generateWarmerConversation({
      credentials: cred,
      names: [nameA, nameB],
      turns: decision.turns,
      style: ai.style,
      campaign: ai.campaign,
    });
  } catch (e: any) {
    await prisma.warmerEvent.create({
      data: {
        workspaceId: run.workspaceId,
        runId: run.id,
        instanceId: decision.instanceId,
        kind: "error",
        detail: { message: "ai generation failed: " + String(e?.message ?? e).slice(0, 200) },
      } as any,
    });
    return null;
  }

  const plan = planConversation({ config, decision, lines, senderNumber: senderNumber ?? "", partnerNumber });
  // Trim the conversation so no number exceeds its remaining ramped quota this tick.
  const budget = new Map<string, number>();
  const trimmed = plan.filter((s) => {
    const rem = budget.has(s.instanceId) ? budget.get(s.instanceId)! : remaining(s.instanceId);
    if (rem <= 0) return false;
    budget.set(s.instanceId, rem - 1);
    return true;
  });
  if (trimmed.length === 0) return null;

  await prisma.warmerEvent.create({
    data: {
      workspaceId: run.workspaceId,
      runId: run.id,
      instanceId: decision.instanceId,
      kind: "info",
      detail: { aiConversation: true, turns: lines.length, sends: trimmed.length, mode: config.mode, to: partnerNumber, preview: lines.slice(0, 3) },
    } as any,
  });

  for (const s of trimmed) await enqueueSend(sendQueue, run, s);
  return trimmed.length;
}

export async function runWarmerTick(sendQueue: Queue, opts?: { now?: Date }): Promise<{ enqueued: number }> {
  const now = opts?.now ?? new Date();
  const runs = await prisma.warmerRun.findMany({
    where: { status: "running" },
    include: { profile: true },
    take: 50,
  });

  // Resolve each workspace's timezone so the schedule window + time-of-day
  // weights track LOCAL time (e.g. Malaysia) rather than UTC.
  const workspaceIds = [...new Set(runs.map((r) => r.workspaceId))];
  const workspaces = workspaceIds.length
    ? await prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, timezone: true } })
    : [];
  const tzByWorkspace = new Map(workspaces.map((w) => [w.id, w.timezone]));

  let enqueued = 0;
  for (const run of runs) {
    const rawConfig = run.profile.config as unknown as WarmerConfig;

    // Warm only via currently-connected numbers — never send from/to a dead one.
    const participating = rawConfig.participatingInstanceIds ?? [];
    const states = participating.length
      ? await prisma.instance.findMany({
          where: { id: { in: participating }, connectionState: "open", deliveryStatus: { notIn: ["delivery_failing", "send_failing"] } },
          select: { id: true },
        })
      : [];
    const connectedIds = states.map((s) => s.id);
    const config: WarmerConfig = {
      ...rawConfig,
      participatingInstanceIds: connectedIds,
      timezone: rawConfig.timezone ?? tzByWorkspace.get(run.workspaceId) ?? "Asia/Kuala_Lumpur",
    };

    // Pair mode needs external partner numbers; with none it can never send.
    if (config.mode === "pair" && (rawConfig.outboundPartners?.length ?? 0) === 0) {
      await noteIdle(run, "pair_no_partners", "This profile is in Pair mode but has no outbound partner numbers. Add partner numbers, or switch to Internal mode so your own connected numbers warm each other.");
      continue;
    }
    // Internal mode needs 2 live numbers; pair mode needs 1 + a partner.
    if (config.mode !== "pair" && connectedIds.length < 2) {
      await noteIdle(run, "need_two_connected", `Internal warming needs at least 2 connected numbers — only ${connectedIds.length} of ${participating.length} selected number(s) are connected. Connect more, or reconnect them.`);
      continue;
    }
    if (config.mode === "pair" && connectedIds.length < 1) {
      await noteIdle(run, "no_connected", "No selected number is currently connected. Connect a number to start warming.");
      continue;
    }

    const { remaining } = await rampContext(run, config, now);

    // AI conversation mode (opt-in per profile). Falls back to static templates
    // when AI is unavailable so non-AI tenants keep warming as before.
    if (config.ai?.enabled) {
      const aiCount = await runAiConversation(sendQueue, run, config, now, remaining);
      if (aiCount !== null) {
        enqueued += aiCount;
        continue;
      }
    }

    // --- static template warmer ---
    let templates = await prisma.warmerTemplate.findMany({
      where: { workspaceId: run.workspaceId, warmerProfileId: run.profileId },
      select: { body: true },
      take: 100,
    });
    if (templates.length === 0) {
      templates = await prisma.warmerTemplate.findMany({
        where: { workspaceId: run.workspaceId, warmerProfileId: null },
        select: { body: true },
        take: 100,
      });
    }
    if (templates.length === 0) {
      await noteIdle(run, "no_templates", "No warmer templates found for this profile. Add message templates, or enable AI generation with credentials.");
      continue;
    }
    const move = nextMove({ config, templateBodies: templates.map((t) => t.body), now });
    if (!move) continue;
    if (remaining(move.instanceId) <= 0) continue; // ramp quota reached for this number today

    await prisma.warmerEvent.create({
      data: {
        workspaceId: run.workspaceId,
        runId: run.id,
        instanceId: move.instanceId,
        kind: "info",
        detail: { to: move.to, textPreview: move.text.slice(0, 80), typingDelayMs: move.typingDelayMs, scheduledDelayMs: move.scheduledDelayMs },
      } as any,
    });
    await enqueueSend(sendQueue, run, move);
    enqueued += 1;
  }
  return { enqueued };
}
