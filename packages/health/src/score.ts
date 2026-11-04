export type RiskLevel = "healthy" | "caution" | "at_risk";

export interface HealthMetrics {
  /** Distinct contacts we messaged first in the window. */
  businessInitiatedConversations: number;
  /** 0..1 — of business-initiated conversations, share that got a reply. */
  replyRatio: number;
  /** 0..1 — failed / attempted bulk targets in the window. */
  failureRate: number;
  /** 0..1 — conversations with outbound but zero inbound. */
  outboundOnlyConversationPct: number;
  /** connection flaps observed in the window. */
  disconnectCount: number;
  /** 0..1 — today's bulk sends / today's ramp cap. */
  capUsagePct: number;
}

export interface Factor {
  key: "replyRatio" | "outboundOnly" | "failureRate" | "disconnects" | "capUsage";
  /** 0..1 — 1 is perfect, 0 is worst. */
  goodness: number;
  weight: number;
  insufficientData?: boolean;
}

const WEIGHTS = { replyRatio: 40, outboundOnly: 20, failureRate: 20, disconnects: 10, capUsage: 10 };
const MIN_CONVERSATIONS_FOR_REPLY = 10;
const DISCONNECTS_FULL_PENALTY_AT = 5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeHealthScore(m: HealthMetrics): {
  score: number;
  risk: RiskLevel;
  factors: Factor[];
} {
  const replyInsufficient = m.businessInitiatedConversations < MIN_CONVERSATIONS_FOR_REPLY;
  const factors: Factor[] = [
    {
      key: "replyRatio",
      // Reply ratio of 0.3+ is treated as fully healthy.
      goodness: replyInsufficient ? 1 : clamp01(m.replyRatio / 0.3),
      weight: WEIGHTS.replyRatio,
      insufficientData: replyInsufficient,
    },
    { key: "outboundOnly", goodness: clamp01(1 - m.outboundOnlyConversationPct), weight: WEIGHTS.outboundOnly },
    { key: "failureRate", goodness: clamp01(1 - m.failureRate / 0.2), weight: WEIGHTS.failureRate },
    { key: "disconnects", goodness: clamp01(1 - m.disconnectCount / DISCONNECTS_FULL_PENALTY_AT), weight: WEIGHTS.disconnects },
    { key: "capUsage", goodness: clamp01(1 - m.capUsagePct), weight: WEIGHTS.capUsage },
  ];

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const weighted = factors.reduce((s, f) => s + f.goodness * f.weight, 0);
  const score = Math.round((weighted / totalWeight) * 100);
  const risk: RiskLevel = score >= 70 ? "healthy" : score >= 40 ? "caution" : "at_risk";
  return { score, risk, factors };
}
