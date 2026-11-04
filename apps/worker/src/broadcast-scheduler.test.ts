import { describe, it, expect, beforeEach, vi } from "vitest";
import { computeSendDelayMs } from "./broadcast-scheduler";
import { isWithinSchedule } from "@evo/schedule";

vi.mock("@evo/send", () => ({
  // Unlimited ramp allowance so the scheduler proceeds past the warm-up gate.
  remainingBulkToday: vi.fn(async () => null),
}));

const { prisma } = await import("@evo/db");
const { runScheduler } = await import("./broadcast-scheduler");

describe("computeSendDelayMs", () => {
  it("uses the seconds interval range when set (rnd=0 => min)", () => {
    expect(computeSendDelayMs({ intervalMinSec: 5, intervalMaxSec: 30, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 0)).toBe(5000);
  });
  it("uses the seconds interval range (rnd=1 => max)", () => {
    expect(computeSendDelayMs({ intervalMinSec: 5, intervalMaxSec: 30, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 1)).toBe(30000);
  });
  it("falls back to ms jitter when interval is null", () => {
    expect(computeSendDelayMs({ intervalMinSec: null, intervalMaxSec: null, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 0)).toBe(2000);
  });
  it("returns min when rnd=0 with jitter fallback", () => {
    expect(computeSendDelayMs({ intervalMinSec: null, intervalMaxSec: null, jitterMinMs: 3000, jitterMaxMs: 9000 }, () => 0)).toBe(3000);
  });
  it("returns max when rnd=1 with jitter fallback", () => {
    expect(computeSendDelayMs({ intervalMinSec: null, intervalMaxSec: null, jitterMinMs: 3000, jitterMaxMs: 9000 }, () => 1)).toBe(9000);
  });
  it("handles equal min=max (interval)", () => {
    expect(computeSendDelayMs({ intervalMinSec: 10, intervalMaxSec: 10, jitterMinMs: 0, jitterMaxMs: 0 }, () => 0.5)).toBe(10000);
  });
});

describe("schedule defer (window gating)", () => {
  it("defers (false) outside the window and runs (true) inside", () => {
    expect(isWithinSchedule({ parts: ["daytime"] }, new Date("2026-06-19T02:00:00"))).toBe(false);
    expect(isWithinSchedule({ parts: ["daytime"] }, new Date("2026-06-19T10:00:00"))).toBe(true);
  });
  it("passes (true) when no config (null)", () => {
    expect(isWithinSchedule(null, new Date("2026-06-19T02:00:00"))).toBe(true);
  });
  it("defers nighttime in daytime hours", () => {
    expect(isWithinSchedule({ parts: ["nighttime"] }, new Date("2026-06-19T12:00:00"))).toBe(false);
    expect(isWithinSchedule({ parts: ["nighttime"] }, new Date("2026-06-19T22:00:00"))).toBe(true);
  });
});

describe("runScheduler failover (DB-backed)", () => {
  async function reset() {
    await prisma.broadcastTarget.deleteMany();
    await prisma.broadcast.deleteMany();
    await prisma.contactListMember.deleteMany();
    await prisma.contactList.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.messageTemplate.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspace.deleteMany();
  }

  const fakeQueue = { add: vi.fn(async () => undefined) } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await reset();
  });

  async function seed(activeState: "open" | "close", fallbackState: "open" | "close") {
    const ws = await prisma.workspace.create({ data: { name: "F", slug: "f-" + Date.now() + "-" + Math.random() } });
    const active = await prisma.instance.create({
      data: { workspaceId: ws.id, label: "active", evolutionInstanceName: "evo-a-" + Date.now() + Math.random(), evolutionApiKey: "K", connectionState: activeState },
    });
    const backup = await prisma.instance.create({
      data: { workspaceId: ws.id, label: "backup", evolutionInstanceName: "evo-b-" + Date.now() + Math.random(), evolutionApiKey: "K", connectionState: fallbackState },
    });
    const c1 = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "601" } });
    const c2 = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "602" } });
    const list = await prisma.contactList.create({ data: { workspaceId: ws.id, name: "L" } });
    const tpl = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "T", body: "hi {{name}}" } });
    const b = await prisma.broadcast.create({
      data: {
        workspaceId: ws.id, instanceId: active.id, listId: list.id, templateId: tpl.id,
        name: "B1", status: "running", createdByUserId: "user-x",
        fallbackInstanceIds: [backup.id],
      } as any,
    });
    const queued = await prisma.broadcastTarget.create({
      data: { workspaceId: ws.id, broadcastId: b.id, contactId: c1.id, status: "queued" },
    });
    const failed = await prisma.broadcastTarget.create({
      data: { workspaceId: ws.id, broadcastId: b.id, contactId: c2.id, status: "failed", error: "banned" },
    });
    return { ws, active, backup, broadcast: b, queuedTargetId: queued.id, failedTargetId: failed.id };
  }

  it("switches to the connected backup and re-queues the failed target when the active number is offline", async () => {
    const { active, backup, broadcast, failedTargetId } = await seed("close", "open");

    await runScheduler(fakeQueue);

    const after = await prisma.broadcast.findUnique({ where: { id: broadcast.id } });
    expect(after?.instanceId).toBe(backup.id);
    expect(after?.instanceId).not.toBe(active.id);

    // The salvaged target was re-queued (error cleared, no longer "failed"). It may
    // then be picked up within the same tick and advanced to "sending".
    const failed = await prisma.broadcastTarget.findUnique({ where: { id: failedTargetId } });
    expect(failed?.status).not.toBe("failed");
    expect(["queued", "sending"]).toContain(failed?.status);
    expect(failed?.error).toBeNull();
  });

  it("does not switch when the active number is open", async () => {
    const { active, broadcast, failedTargetId } = await seed("open", "open");

    await runScheduler(fakeQueue);

    const after = await prisma.broadcast.findUnique({ where: { id: broadcast.id } });
    expect(after?.instanceId).toBe(active.id);

    // No salvage requeue happened on the healthy path.
    const failed = await prisma.broadcastTarget.findUnique({ where: { id: failedTargetId } });
    expect(failed?.status).toBe("failed");
  });
});

describe("runScheduler pacing (DB-backed)", () => {
  const fakeQueue = { add: vi.fn(async () => undefined) } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.broadcastTarget.deleteMany();
    await prisma.broadcast.deleteMany();
    await prisma.contactListMember.deleteMany();
    await prisma.contactList.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.messageTemplate.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspace.deleteMany();
  });

  it("staggers sends CUMULATIVELY (each spaced by one gap) instead of bunching them in one window", async () => {
    const uniq = Date.now() + "-" + Math.random();
    const ws = await prisma.workspace.create({ data: { name: "P", slug: "p-" + uniq } });
    const inst = await prisma.instance.create({
      data: { workspaceId: ws.id, label: "a", evolutionInstanceName: "evo-p-" + uniq, evolutionApiKey: "K", connectionState: "open" },
    });
    const list = await prisma.contactList.create({ data: { workspaceId: ws.id, name: "L" } });
    const tpl = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "T", body: "hi {{name}}" } });
    const b = await prisma.broadcast.create({
      data: {
        workspaceId: ws.id, instanceId: inst.id, listId: list.id, templateId: tpl.id,
        name: "B", status: "running", createdByUserId: "u",
        intervalMinSec: 45, intervalMaxSec: 90,
      } as any,
    });
    for (let i = 0; i < 5; i++) {
      const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60100000" + (1000 + i) } });
      await prisma.broadcastTarget.create({ data: { workspaceId: ws.id, broadcastId: b.id, contactId: c.id, status: "queued" } });
    }

    await runScheduler(fakeQueue);

    const delays: number[] = fakeQueue.add.mock.calls.map((call: any[]) => call[2].delay);
    expect(delays.length).toBe(5);
    // First send is a full gap out (not instant), and each subsequent send is one
    // gap (45–90s) AFTER the previous — the regression guard: before the fix these
    // were independent random delays all inside [45s,90s], so steps could be ~0.
    expect(delays[0]).toBeGreaterThanOrEqual(45_000);
    for (let i = 1; i < delays.length; i++) {
      const step = delays[i]! - delays[i - 1]!;
      expect(step).toBeGreaterThanOrEqual(45_000);
      expect(step).toBeLessThanOrEqual(90_000);
    }
    // The pacing cursor is persisted so the next tick continues where this left off.
    const after = await prisma.broadcast.findUnique({ where: { id: b.id } });
    expect(after?.nextSlotAt).toBeTruthy();
  });
});

describe("runScheduler group mode (DB-backed)", () => {
  const fakeQueue = { add: vi.fn(async () => undefined) } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.broadcastTarget.deleteMany();
    await prisma.broadcast.deleteMany();
    await prisma.instanceGroupMember.deleteMany();
    await prisma.instanceGroup.deleteMany();
    await prisma.contactListMember.deleteMany();
    await prisma.contactList.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.messageTemplate.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspace.deleteMany();
  });

  async function seedGroup(opts: { mode: "parallel" | "rotate"; states: ("open" | "close")[]; queued: number; rotateEvery?: number }) {
    const uniq = Date.now() + "-" + Math.random();
    const ws = await prisma.workspace.create({ data: { name: "G", slug: "g-" + uniq } });
    const insts: Awaited<ReturnType<typeof prisma.instance.create>>[] = [];
    for (let i = 0; i < opts.states.length; i++) {
      insts.push(await prisma.instance.create({
        data: { workspaceId: ws.id, label: "n" + i, evolutionInstanceName: "evo-" + i + "-" + uniq, evolutionApiKey: "K", connectionState: opts.states[i]! },
      }));
    }
    const group = await prisma.instanceGroup.create({ data: { workspaceId: ws.id, name: "grp-" + uniq } });
    await prisma.instanceGroupMember.createMany({ data: insts.map((i) => ({ groupId: group.id, instanceId: i.id })) });
    const list = await prisma.contactList.create({ data: { workspaceId: ws.id, name: "L" } });
    const tpl = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "T", body: "hi {{name}}" } });
    const b = await prisma.broadcast.create({
      data: {
        workspaceId: ws.id, instanceId: insts[0]!.id, listId: list.id, templateId: tpl.id,
        name: "B", status: "running", createdByUserId: "u",
        intervalMinSec: 45, intervalMaxSec: 90,
        instanceGroupId: group.id, groupSendMode: opts.mode, rotateEvery: opts.rotateEvery ?? null,
      } as any,
    });
    for (let i = 0; i < opts.queued; i++) {
      const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60100" + (10000 + i) } });
      await prisma.broadcastTarget.create({ data: { workspaceId: ws.id, broadcastId: b.id, contactId: c.id, status: "queued" } });
    }
    return { ws, insts, group, broadcast: b };
  }

  it("parallel: distributes across all open members (each target tagged with an instanceId)", async () => {
    const { insts } = await seedGroup({ mode: "parallel", states: ["open", "open"], queued: 6 });
    await runScheduler(fakeQueue);
    const used = new Set(fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId));
    expect(used.size).toBe(2); // both numbers used
    expect([...used].every((id) => insts.some((i) => i.id === id))).toBe(true);
  });

  it("parallel: skips a closed member (only the open number is used)", async () => {
    const { insts } = await seedGroup({ mode: "parallel", states: ["open", "close"], queued: 4 });
    await runScheduler(fakeQueue);
    const used = new Set(fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId));
    expect(used.size).toBe(1);
    expect([...used][0]).toBe(insts[0]!.id);
  });

  it("rotate: sends rotateEvery on the first number, then switches to the next", async () => {
    const { insts } = await seedGroup({ mode: "rotate", states: ["open", "open"], queued: 5, rotateEvery: 2 });
    await runScheduler(fakeQueue);
    const usedInOrder = fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId);
    // First 2 → number A, next 2 → number B, next → number A again (cycle).
    expect(usedInOrder.slice(0, 2).every((id: string) => id === insts[0]!.id)).toBe(true);
    expect(usedInOrder.slice(2, 4).every((id: string) => id === insts[1]!.id)).toBe(true);
  });

  it("group failover: re-queues a sending target whose number went offline", async () => {
    const { insts, group, broadcast, ws } = await seedGroup({ mode: "parallel", states: ["open", "open"], queued: 0 });
    // A target already 'sending' on inst[1], which we now mark closed.
    await prisma.instance.update({ where: { id: insts[1]!.id }, data: { connectionState: "close" } });
    const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60199999999" } });
    const t = await prisma.broadcastTarget.create({ data: { workspaceId: ws.id, broadcastId: broadcast.id, contactId: c.id, status: "sending", instanceId: insts[1]!.id } });
    await runScheduler(fakeQueue);
    const after = await prisma.broadcastTarget.findUnique({ where: { id: t.id } });
    // Re-queued off the dead number, then possibly re-assigned to the open one this tick.
    expect(after?.status).not.toBe("sending");
    if (after?.status === "sending") expect(after.instanceId).toBe(insts[0]!.id);
  });

  it("parallel: skips a send_failing member even when connectionState is open (only healthy number is used)", async () => {
    // Both instances are open, but inst[1] has deliveryStatus "send_failing".
    const { insts, ws, broadcast } = await seedGroup({ mode: "parallel", states: ["open", "open"], queued: 4 });
    await prisma.instance.update({ where: { id: insts[1]!.id }, data: { deliveryStatus: "send_failing" } });

    await runScheduler(fakeQueue);

    const usedIds = fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId) as string[];
    expect(usedIds.length).toBeGreaterThan(0);
    // The flagged number must never appear in any send job.
    expect(usedIds).not.toContain(insts[1]!.id);
    // All sends go through the healthy number.
    expect(usedIds.every((id) => id === insts[0]!.id)).toBe(true);
  });
});
