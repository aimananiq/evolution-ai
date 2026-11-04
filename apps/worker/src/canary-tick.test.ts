import { describe, it, expect, beforeEach, vi } from "vitest";

const sendViaInstance = vi.fn(async () => ({ key: { id: "x" } }));
vi.mock("@evo/send", () => ({
  sendViaInstance,
}));

const { prisma } = await import("@evo/db");
const { runCanaryTick } = await import("./canary-tick");

async function reset() {
  await prisma.deliverabilityProbe.deleteMany();
  await prisma.healthAlert.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

async function makeWorkspace() {
  const uniq = Date.now() + "-" + Math.random();
  return prisma.workspace.create({ data: { name: "W", slug: "w-" + uniq } });
}

async function makeInstance(
  workspaceId: string,
  opts: { state: "open" | "close"; phone?: string | null; sendFailStreak?: number; label?: string } = { state: "open" },
) {
  const uniq = Date.now() + "-" + Math.random();
  return prisma.instance.create({
    data: {
      workspaceId,
      label: opts.label ?? "n-" + uniq,
      evolutionInstanceName: "evo-" + uniq,
      evolutionApiKey: "K",
      connectionState: opts.state,
      phoneNumber: opts.phone === undefined ? "60" + Math.floor(Math.random() * 1e9) : opts.phone,
      sendFailStreak: opts.sendFailStreak ?? 0,
    },
  });
}

describe("runCanaryTick (DB-backed)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await reset();
  });

  it("sends a probe between two connected instances and skips a lone connected instance", async () => {
    const ws = await makeWorkspace();
    const a = await makeInstance(ws.id, { state: "open", phone: "60111111111" });
    const b = await makeInstance(ws.id, { state: "open", phone: "60222222222" });

    // A workspace with only one connected instance produces no probe.
    const solo = await makeWorkspace();
    await makeInstance(solo.id, { state: "open", phone: "60999999999" });

    const { probed } = await runCanaryTick();

    // Both members of the 2-number workspace get probed; the solo workspace does not.
    expect(probed).toBe(2);

    const probes = await prisma.deliverabilityProbe.findMany({ where: { workspaceId: ws.id } });
    expect(probes.length).toBe(2);
    for (const p of probes) {
      expect(p.status).toBe("pending");
      expect([a.id, b.id]).toContain(p.instanceId);
      expect([a.id, b.id]).toContain(p.controlInstanceId);
      expect(p.instanceId).not.toBe(p.controlInstanceId);
    }

    // The solo workspace has no probes.
    const soloProbes = await prisma.deliverabilityProbe.findMany({ where: { workspaceId: solo.id } });
    expect(soloProbes.length).toBe(0);

    // sendViaInstance was called with the probe text to the control's phone.
    expect(sendViaInstance).toHaveBeenCalledTimes(2);
    const bodies = sendViaInstance.mock.calls.map((c: any[]) => c[1]);
    for (const payload of bodies) {
      expect(payload.type).toBe("text");
      expect(payload.text).toMatch(/^wasap-probe:/);
      expect([a.phoneNumber, b.phoneNumber]).toContain(payload.to);
    }
  });

  it("miss → flag: two missed probes flip deliveryStatus to delivery_failing", async () => {
    const ws = await makeWorkspace();
    const a = await makeInstance(ws.id, { state: "open", phone: "60111111111" });
    const b = await makeInstance(ws.id, { state: "open", phone: "60222222222" });

    async function ageOutProbe() {
      const probe = await prisma.deliverabilityProbe.create({
        data: { workspaceId: ws.id, instanceId: a.id, controlInstanceId: b.id, token: "t-" + Date.now() + "-" + Math.random() },
      });
      // Place its sentAt 11 minutes in the past so it's beyond the 10-min timeout.
      await prisma.deliverabilityProbe.update({
        where: { id: probe.id },
        data: { sentAt: new Date(Date.now() - 11 * 60 * 1000) },
      });
      return probe;
    }

    // First miss: a recent probe exists so no NEW probe is sent to a; streak becomes 1.
    const p1 = await ageOutProbe();
    // Keep a "recent" probe so the tick doesn't re-probe a during this call.
    await prisma.deliverabilityProbe.create({
      data: { workspaceId: ws.id, instanceId: a.id, controlInstanceId: b.id, token: "recent-a-1-" + Math.random(), sentAt: new Date() },
    });
    await prisma.deliverabilityProbe.create({
      data: { workspaceId: ws.id, instanceId: b.id, controlInstanceId: a.id, token: "recent-b-1-" + Math.random(), sentAt: new Date() },
    });

    await runCanaryTick();

    let after = await prisma.instance.findUnique({ where: { id: a.id } });
    expect(after?.deliveryMissStreak).toBe(1);
    expect(after?.deliveryStatus).not.toBe("delivery_failing");
    const missed1 = await prisma.deliverabilityProbe.findUnique({ where: { id: p1.id } });
    expect(missed1?.status).toBe("missed");

    // Second miss → streak 2 → delivery_failing.
    const p2 = await ageOutProbe();
    await prisma.deliverabilityProbe.create({
      data: { workspaceId: ws.id, instanceId: a.id, controlInstanceId: b.id, token: "recent-a-2-" + Math.random(), sentAt: new Date() },
    });
    await prisma.deliverabilityProbe.create({
      data: { workspaceId: ws.id, instanceId: b.id, controlInstanceId: a.id, token: "recent-b-2-" + Math.random(), sentAt: new Date() },
    });

    await runCanaryTick();

    after = await prisma.instance.findUnique({ where: { id: a.id } });
    expect(after?.deliveryMissStreak).toBe(2);
    expect(after?.deliveryStatus).toBe("delivery_failing");
    const missed2 = await prisma.deliverabilityProbe.findUnique({ where: { id: p2.id } });
    expect(missed2?.status).toBe("missed");
  });

  it("send_failing: an instance with sendFailStreak >= 5 gets deliveryStatus send_failing", async () => {
    const ws = await makeWorkspace();
    const a = await makeInstance(ws.id, { state: "open", phone: "60111111111", sendFailStreak: 5 });

    await runCanaryTick();

    const after = await prisma.instance.findUnique({ where: { id: a.id } });
    expect(after?.deliveryStatus).toBe("send_failing");
    expect(after?.deliveryCheckedAt).toBeTruthy();
  });
});
