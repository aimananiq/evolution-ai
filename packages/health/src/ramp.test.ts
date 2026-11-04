import { describe, it, expect } from "vitest";
import { rampCapForDay, type RampPolicy } from "./ramp";

const policy: RampPolicy = { rampBaseDaily: 20, rampGrowthPct: 15, rampMaxDaily: 500 };

describe("rampCapForDay", () => {
  it("returns base on day 0", () => {
    expect(rampCapForDay(policy, 0)).toBe(20);
  });
  it("compounds growth per day (floored)", () => {
    // 20 * 1.15^1 = 23, 20 * 1.15^2 = 26.45 -> 26
    expect(rampCapForDay(policy, 1)).toBe(23);
    expect(rampCapForDay(policy, 2)).toBe(26);
  });
  it("clamps at max", () => {
    expect(rampCapForDay(policy, 100)).toBe(500);
  });
  it("treats negative dayIndex as day 0", () => {
    expect(rampCapForDay(policy, -3)).toBe(20);
  });
});
