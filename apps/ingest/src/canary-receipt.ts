import type { NormalisedEvent } from "./normalise.js";

/**
 * Deliverability canary: if the inbound message is a probe from another of our
 * numbers (body `wasap-probe:<token>`), mark the probe delivered — which clears
 * the sender instance's slow-ban flag — and report that it was swallowed.
 *
 * Returns true when the event was a probe receipt (and has been handled), in
 * which case the caller MUST NOT persist it, run automation, or notify.
 */
export async function handleProbeReceipt(evt: NormalisedEvent): Promise<boolean> {
  const probeMatch =
    evt.kind === "message" && evt.direction === "inbound" && typeof evt.body === "string"
      ? evt.body.trim().match(/^wasap-probe:(\S+)$/)
      : null;
  if (!probeMatch) return false;

  const token = probeMatch[1]!;
  const { prisma } = await import("@evo/db");
  const probe = await prisma.deliverabilityProbe.findUnique({ where: { token } });
  if (probe && probe.status !== "delivered") {
    await prisma.deliverabilityProbe.update({
      where: { id: probe.id },
      data: { status: "delivered", receivedAt: new Date() },
    });
    await prisma.instance
      .update({
        where: { id: probe.instanceId },
        data: { deliveryStatus: "ok", deliveryMissStreak: 0, deliveryCheckedAt: new Date() },
      })
      .catch(() => {});
  }
  return true; // swallow — no conversation/bot/notification
}
