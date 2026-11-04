import { describe, it, expect } from "vitest";
import { decideConversation, planConversation, type WarmerConfig } from "./index";

const pacing = {
  typingPerCharMs: 100,
  typingMinMs: 500,
  typingMaxMs: 5000,
  replyMinMs: 1000,
  replyMaxMs: 3000,
  minTurnsPerConversation: 4,
  maxTurnsPerConversation: 8,
};

const base: WarmerConfig = {
  mode: "internal",
  participatingInstanceIds: ["A", "B"],
  schedule: { startHour: 0, endHour: 24, skipProbability: 0 },
  pacing,
  timeOfDayWeights: new Array(24).fill(1),
  dayOfWeekWeights: new Array(7).fill(1),
  ai: { enabled: true, minTurns: 4, maxTurns: 4 },
};

describe("planConversation", () => {
  it("internal mode: every line is sent, alternating sender/recipient, delays grow", () => {
    const decision = { instanceId: "A", partnerInstanceId: "B", turns: 4 };
    const sends = planConversation({
      config: base,
      decision,
      lines: ["l0", "l1", "l2", "l3"],
      senderNumber: "60A",
      partnerNumber: "60B",
      random: () => 0, // replyGap = replyMin
    });
    expect(sends).toHaveLength(4);
    expect(sends.map((s) => s.instanceId)).toEqual(["A", "B", "A", "B"]);
    expect(sends.map((s) => s.to)).toEqual(["60B", "60A", "60B", "60A"]);
    expect(sends[0]!.scheduledDelayMs).toBe(0);
    // strictly increasing schedule
    for (let i = 1; i < sends.length; i++) expect(sends[i]!.scheduledDelayMs).toBeGreaterThan(sends[i - 1]!.scheduledDelayMs);
  });

  it("pair mode: only the primary instance sends (to the external partner)", () => {
    const decision = { instanceId: "A", partnerNumber: "60EXT", turns: 4 };
    const sends = planConversation({
      config: { ...base, mode: "pair" },
      decision,
      lines: ["l0", "l1", "l2", "l3"],
      senderNumber: "60A",
      partnerNumber: "60EXT",
      random: () => 0,
    });
    expect(sends).toHaveLength(2); // even indices only
    expect(sends.every((s) => s.instanceId === "A" && s.to === "60EXT")).toBe(true);
    expect(sends.map((s) => s.text)).toEqual(["l0", "l2"]);
    expect(sends[1]!.scheduledDelayMs).toBeGreaterThan(0); // accounts for skipped partner turn
  });
});

describe("decideConversation", () => {
  it("returns an internal decision with a partner instance", () => {
    const d = decideConversation({ config: base, now: new Date(Date.UTC(2026, 0, 1, 12)), random: () => 0.0 });
    expect(d).not.toBeNull();
    expect(d!.instanceId).toBe("A");
    expect(d!.partnerInstanceId).toBe("B");
    expect(d!.turns).toBe(4);
  });

  it("declines outside the schedule window", () => {
    const cfg = { ...base, schedule: { startHour: 9, endHour: 17, skipProbability: 0 } };
    const d = decideConversation({ config: cfg, now: new Date(Date.UTC(2026, 0, 1, 3)), random: () => 0 });
    expect(d).toBeNull();
  });

  it("pair mode returns the outbound partner number", () => {
    const cfg: WarmerConfig = { ...base, mode: "pair", outboundPartners: [{ number: "60EXT", label: "Partner" }] };
    const d = decideConversation({ config: cfg, now: new Date(Date.UTC(2026, 0, 1, 12)), random: () => 0 });
    expect(d!.partnerNumber).toBe("60EXT");
    expect(d!.partnerInstanceId).toBeUndefined();
  });
});
