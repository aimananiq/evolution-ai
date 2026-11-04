import { describe, it, expect } from "vitest";
import { computeHealthScore, type HealthMetrics } from "./score";

const good: HealthMetrics = {
  businessInitiatedConversations: 50,
  replyRatio: 0.6,
  failureRate: 0.01,
  outboundOnlyConversationPct: 0.1,
  disconnectCount: 0,
  capUsagePct: 0.3,
};

describe("computeHealthScore", () => {
  it("scores a healthy instance high", () => {
    const r = computeHealthScore(good);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.risk).toBe("healthy");
  });

  it("scores a spammy instance at_risk", () => {
    const bad: HealthMetrics = {
      businessInitiatedConversations: 200,
      replyRatio: 0.02,
      failureRate: 0.4,
      outboundOnlyConversationPct: 0.9,
      disconnectCount: 5,
      capUsagePct: 1,
    };
    const r = computeHealthScore(bad);
    expect(r.score).toBeLessThan(40);
    expect(r.risk).toBe("at_risk");
  });

  it("returns caution in the middle band", () => {
    const mid: HealthMetrics = {
      businessInitiatedConversations: 40,
      replyRatio: 0.2,
      failureRate: 0.1,
      outboundOnlyConversationPct: 0.5,
      disconnectCount: 1,
      capUsagePct: 0.6,
    };
    const r = computeHealthScore(mid);
    expect(r.risk).toBe("caution");
  });

  it("treats sparse reply data as neutral, not punitive", () => {
    const sparse: HealthMetrics = {
      businessInitiatedConversations: 3,
      replyRatio: 0,
      failureRate: 0,
      outboundOnlyConversationPct: 0,
      disconnectCount: 0,
      capUsagePct: 0,
    };
    const r = computeHealthScore(sparse);
    const replyFactor = r.factors.find((f) => f.key === "replyRatio");
    expect(replyFactor?.insufficientData).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("always includes all five factors", () => {
    const r = computeHealthScore(good);
    expect(r.factors.map((f) => f.key).sort()).toEqual(
      ["capUsage", "disconnects", "failureRate", "outboundOnly", "replyRatio"],
    );
  });
});
