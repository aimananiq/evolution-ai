import { describe, it, expect } from "vitest";
import { bulkSendKey, utcDateStamp } from "./keys";

describe("bulkSendKey", () => {
  it("builds a per-instance per-UTC-day key", () => {
    const d = new Date("2026-07-03T23:30:00.000Z");
    expect(bulkSendKey("inst_1", d)).toBe("health:bulk:inst_1:2026-07-03");
  });
  it("uses UTC day, not local", () => {
    const d = new Date("2026-07-03T23:30:00.000Z");
    expect(utcDateStamp(d)).toBe("2026-07-03");
  });
});
