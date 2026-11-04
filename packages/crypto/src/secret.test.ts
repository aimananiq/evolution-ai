import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, revealSecret } from "./index";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

describe("encryptSecret / revealSecret", () => {
  it("round-trips a secret through tagged ciphertext", async () => {
    const stored = await encryptSecret("evolution-token-123");
    expect(stored.startsWith("enc:")).toBe(true);
    expect(stored).not.toContain("evolution-token-123");
    expect(await revealSecret(stored)).toBe("evolution-token-123");
  });

  it("passes legacy plaintext through unchanged", async () => {
    expect(await revealSecret("legacy-plain-token")).toBe("legacy-plain-token");
  });
});
