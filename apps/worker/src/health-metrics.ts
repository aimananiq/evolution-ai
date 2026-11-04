import { prisma } from "@evo/db";
import { rampCapForDay, daysSince, bulkSendKey, type HealthMetrics } from "@evo/health";
import { redis } from "@evo/queue";

const WINDOW_DAYS = 7;

export async function collectMetrics(
  instanceId: string,
  workspaceId: string,
  now: Date,
): Promise<HealthMetrics> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  // Business-initiated conversations: those with >=1 outbound message in the window.
  const convs = await prisma.conversation.findMany({
    where: { instanceId, messages: { some: { direction: "outbound", sentAt: { gte: since } } } },
    select: {
      id: true,
      messages: { where: { sentAt: { gte: since } }, select: { direction: true } },
    },
  });
  const businessInitiated = convs.length;
  let replied = 0;
  let outboundOnly = 0;
  for (const c of convs) {
    const hasInbound = c.messages.some((m) => m.direction === "inbound");
    if (hasInbound) replied += 1;
    else outboundOnly += 1;
  }
  const replyRatio = businessInitiated > 0 ? replied / businessInitiated : 0;
  const outboundOnlyConversationPct = businessInitiated > 0 ? outboundOnly / businessInitiated : 0;

  // Failure rate over this instance's broadcast targets in the window.
  const attempted = await prisma.broadcastTarget.count({
    where: { workspaceId, sentAt: { gte: since }, broadcast: { instanceId } },
  });
  const failed = await prisma.broadcastTarget.count({
    where: { workspaceId, status: "failed", broadcast: { instanceId } },
  });
  const failureRate = attempted + failed > 0 ? failed / (attempted + failed) : 0;

  // capUsagePct from today's counter vs today's ramp cap.
  let capUsagePct = 0;
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (policy?.rampEnabled && policy.rampStartedAt) {
    const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
    try {
      const used = Number((await redis().get(bulkSendKey(instanceId, now))) ?? 0);
      capUsagePct = cap > 0 ? Math.min(1, used / cap) : 0;
    } catch {
      capUsagePct = 0;
    }
  }

  return {
    businessInitiatedConversations: businessInitiated,
    replyRatio,
    failureRate,
    outboundOnlyConversationPct,
    disconnectCount: 0, // reserved for connection-flap tracking; 0 baseline here
    capUsagePct,
  };
}
