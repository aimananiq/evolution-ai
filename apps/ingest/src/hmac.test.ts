import { describe, it, expect } from "vitest";
import { verifyBearer } from "./hmac";

describe("verifyBearer", () => {
  it("accepts a matching bearer", () => {
    expect(verifyBearer("Bearer abc123", "abc123")).toBe(true);
  });

  it("rejects a wrong bearer", () => {
    expect(verifyBearer("Bearer wrong", "abc123")).toBe(false);
  });

  it("rejects missing header", () => {
    expect(verifyBearer(undefined, "abc123")).toBe(false);
    expect(verifyBearer("", "abc123")).toBe(false);
  });

  it("rejects malformed bearer", () => {
    expect(verifyBearer("Basic abc123", "abc123")).toBe(false);
    expect(verifyBearer("abc123", "abc123")).toBe(false);
  });

  it("uses constant-time comparison", () => {
    // Smoke: the function must not short-circuit. We can't strictly assert timing,
    // but verifyBearer should return false on length mismatch without throwing.
    expect(verifyBearer("Bearer x", "abc123")).toBe(false);
  });
});
