import { describe, it, expect } from "vitest";
import { isWithinSchedule } from "./index";

const at = (iso: string) => new Date(iso);

describe("isWithinSchedule", () => {
  it("returns true when config is null/empty (anytime)", () => {
    expect(isWithinSchedule(null, at("2026-06-19T03:00:00"))).toBe(true);
    expect(isWithinSchedule({ parts: [] }, at("2026-06-19T03:00:00"))).toBe(true);
  });

  it("daytime: true at 10:00, false at 02:00", () => {
    expect(isWithinSchedule({ parts: ["daytime"] }, at("2026-06-19T10:00:00"))).toBe(true);
    expect(isWithinSchedule({ parts: ["daytime"] }, at("2026-06-19T02:00:00"))).toBe(false);
  });

  it("nighttime: true at 23:00, false at 12:00", () => {
    expect(isWithinSchedule({ parts: ["nighttime"] }, at("2026-06-19T23:00:00"))).toBe(true);
    expect(isWithinSchedule({ parts: ["nighttime"] }, at("2026-06-19T12:00:00"))).toBe(false);
  });

  it("odd day: 19th is odd ⇒ true; 18th ⇒ false", () => {
    expect(isWithinSchedule({ parts: ["odd"] }, at("2026-06-19T12:00:00"))).toBe(true);
    expect(isWithinSchedule({ parts: ["odd"] }, at("2026-06-18T12:00:00"))).toBe(false);
  });

  it("even day: 18th ⇒ true; 19th ⇒ false", () => {
    expect(isWithinSchedule({ parts: ["even"] }, at("2026-06-18T12:00:00"))).toBe(true);
    expect(isWithinSchedule({ parts: ["even"] }, at("2026-06-19T12:00:00"))).toBe(false);
  });

  it("OR-combines parts: daytime OR odd ⇒ true at night on an odd day", () => {
    expect(isWithinSchedule({ parts: ["daytime", "odd"] }, at("2026-06-19T23:00:00"))).toBe(true);
  });

  it("hour range further restricts: parts daytime + 09–12 ⇒ false at 14:00", () => {
    expect(isWithinSchedule({ parts: ["daytime"], startHour: 9, endHour: 12 }, at("2026-06-19T14:00:00"))).toBe(false);
    expect(isWithinSchedule({ parts: ["daytime"], startHour: 9, endHour: 12 }, at("2026-06-19T10:00:00"))).toBe(true);
  });

  it("hour range alone (no parts) restricts: 09–17 ⇒ false at 20:00", () => {
    expect(isWithinSchedule({ parts: [], startHour: 9, endHour: 17 }, at("2026-06-19T20:00:00"))).toBe(false);
  });
});
