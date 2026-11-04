import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const CANARY_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CANARY_TIMEOUT_MS = 10 * 60 * 1000;
const MISS_THRESHOLD = 2;
const SENDFAIL_THRESHOLD = 5;

export async function runCanaryTick(opts?: { now?: Date }): Promise<{ probed: number }> {
  const now = opts?.now ?? new Date();

  // 1) Resolve misses: pending probes past the timeout with no receipt.
  const stale = await prisma.deliverabilityProbe.findMany({
    where: { status: "pending", sentAt: { lt: new Date(now.getTime() - CANARY_TIMEOUT_MS) } },
  });
  for (const p of stale) {
    await prisma.deliverabilityProbe.update({ where: { id: p.id }, data: { status: "missed" } });
    const inst = await prisma.instance.update({ where: { id: p.instanceId }, data: { deliveryMissStreak: { increment: 1 }, deliveryCheckedAt: now } });
    if (inst.deliveryMissStreak >= MISS_THRESHOLD && inst.deliveryStatus !== "delivery_failing") {
      await prisma.instance.update({ where: { id: inst.id }, data: { deliveryStatus: "delivery_failing" } });
      await prisma.healthAlert.create({ data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { reason: "delivery_failing", note: "canary probes not delivered" } } as any }).catch(() => {});
    }
  }

  // 2) Flag send-failing numbers (dead session) from the send-failure streak.
  const failing = await prisma.instance.findMany({ where: { sendFailStreak: { gte: SENDFAIL_THRESHOLD }, deliveryStatus: { not: "send_failing" } } });
  for (const inst of failing) {
    await prisma.instance.update({ where: { id: inst.id }, data: { deliveryStatus: "send_failing", deliveryCheckedAt: now } });
    await prisma.healthAlert.create({ data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { reason: "send_failing", note: "repeated Evolution 500 / connection closed on send" } } as any }).catch(() => {});
  }

  // 3) Send new probes: each workspace with >=2 connected numbers probes each number
  //    that hasn't been probed within the interval, to a control (another connected number).
  let probed = 0;
  const connected = await prisma.instance.findMany({ where: { connectionState: "open" }, select: { id: true, workspaceId: true, phoneNumber: true } });
  const byWs = new Map<string, typeof connected>();
  for (const i of connected) { const a = byWs.get(i.workspaceId) ?? []; a.push(i); byWs.set(i.workspaceId, a); }
  const cutoff = new Date(now.getTime() - CANARY_INTERVAL_MS);
  for (const [, members] of byWs) {
    if (members.length < 2) continue;
    for (const x of members) {
      const recent = await prisma.deliverabilityProbe.findFirst({ where: { instanceId: x.id, sentAt: { gt: cutoff } } });
      if (recent) continue;
      // Control = the member (not x) used least-recently as a control for x.
      const controls = members.filter((m) => m.id !== x.id && m.phoneNumber);
      if (controls.length === 0) continue;
      const control = controls[0]!; // simple; refine ordering later
      const probe = await prisma.deliverabilityProbe.create({ data: { workspaceId: x.workspaceId, instanceId: x.id, controlInstanceId: control.id, token: `${probeTokenPrefix()}${x.id}-${now.getTime()}` } });
      try {
        await sendViaInstance(x.id, { type: "text", to: control.phoneNumber!, text: `wasap-probe:${probe.token}`, userId: null } as any, { origin: "warmer" });
        probed += 1;
      } catch { /* send failure already counted in sendViaInstance; probe will time out → miss */ }
    }
  }
  return { probed };
}

function probeTokenPrefix() { return "p_"; }
