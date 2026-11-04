import { describe, it, expect } from "vitest";
import { nextMove } from "./index";
import type { WarmerConfig } from "./types";

const baseConfig: WarmerConfig = {
  mode: "pair",
  participatingInstanceIds: ["inst-A", "inst-B"],
  outboundPartners: [{ number: "60134739063", label: "main" }],
  schedule: { startHour: 9, endHour: 21, skipProbability: 0 },
  pacing: {
    typingPerCharMs: 100,
    typingMinMs: 1000,
    typingMaxMs: 5000,
    replyMinMs: 30000,
    replyMaxMs: 120000,
    minTurnsPerConversation: 3,
    maxTurnsPerConversation: 5,
  },
  timeOfDayWeights: new Array(24).fill(1),
  dayOfWeekWeights: new Array(7).fill(1),
};

describe("nextMove", () => {
  it("returns a move when schedule is open and weights are 1", () => {
    const move = nextMove({
      config: baseConfig,
      templateBodies: ["hello there"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.5,
    });
    expect(move).toBeTruthy();
    expect(["inst-A", "inst-B"]).toContain(move!.instanceId);
    expect(move!.to).toBe("60134739063");
    expect(move!.text).toBe("hello there");
  });

  it("returns null outside the schedule window", () => {
    const move = nextMove({
      config: { ...baseConfig, schedule: { startHour: 10, endHour: 12, skipProbability: 0 } },
      templateBodies: ["hi"],
      now: new Date("2026-06-18T14:00:00Z"),
      random: () => 0,
    });
    expect(move).toBeNull();
  });

  it("returns null when time-of-day weight rolls off", () => {
    const weights = new Array(24).fill(1);
    weights[12] = 0;
    const move = nextMove({
      config: { ...baseConfig, timeOfDayWeights: weights },
      templateBodies: ["hi"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.5,
    });
    expect(move).toBeNull();
  });

  it("respects skipProbability", () => {
    const move = nextMove({
      config: { ...baseConfig, schedule: { startHour: 9, endHour: 21, skipProbability: 0.5 } },
      templateBodies: ["hi"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.4,
    });
    expect(move).toBeNull();
  });

  it("returns null when no participating instances or no partners (pair mode)", () => {
    const empty = nextMove({
      config: { ...baseConfig, participatingInstanceIds: [] },
      templateBodies: ["hi"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.5,
    });
    expect(empty).toBeNull();
    const noPartners = nextMove({
      config: { ...baseConfig, outboundPartners: [] },
      templateBodies: ["hi"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.5,
    });
    expect(noPartners).toBeNull();
  });

  it("typingDelayMs is min(typingMaxMs, typingPerCharMs * text.length) and ≥ typingMinMs", () => {
    const move = nextMove({
      config: baseConfig,
      templateBodies: ["short"],
      now: new Date("2026-06-18T12:00:00Z"),
      random: () => 0.5,
    });
    const expected = Math.min(5000, Math.max(1000, 100 * "short".length));
    expect(move!.typingDelayMs).toBe(expected);
  });
});
