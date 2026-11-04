import { describe, it, expect } from "vitest";
import { dailyQuota, runDayIndex } from "./index";

const ramp = { day0: 30, day14: 800, day30: 3000 };

describe("dailyQuota", () => {
  it("starts low and ramps to the day30 target", () => {
    expect(dailyQuota(ramp, 0)).toBe(30);
    expect(dailyQuota(ramp, 14)).toBe(800);
    expect(dailyQuota(ramp, 30)).toBe(3000);
  });
  it("interpolates between anchors", () => {
    expect(dailyQuota(ramp, 7)).toBeGreaterThan(30);
    expect(dailyQuota(ramp, 7)).toBeLessThan(800);
    expect(dailyQuota(ramp, 22)).toBeGreaterThan(800);
    expect(dailyQuota(ramp, 22)).toBeLessThan(3000);
  });
  it("holds flat after day 30", () => {
    expect(dailyQuota(ramp, 45)).toBe(3000);
    expect(dailyQuota(ramp, 365)).toBe(3000);
  });
  it("never goes negative on day index", () => {
    expect(dailyQuota(ramp, -5)).toBe(30);
  });
});

describe("runDayIndex", () => {
  it("counts whole elapsed days", () => {
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(runDayIndex(start, new Date(Date.UTC(2026, 0, 1, 12)))).toBe(0);
    expect(runDayIndex(start, new Date(Date.UTC(2026, 0, 16, 0)))).toBe(15);
    expect(runDayIndex(start, new Date(Date.UTC(2025, 11, 30)))).toBe(0); // future start → 0
  });
});
