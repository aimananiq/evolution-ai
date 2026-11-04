import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt } from "./encrypt";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "f".repeat(64); // 32 bytes hex
});

describe("encrypt/decrypt", () => {
  it("round-trips a string", async () => {
    const cipher = await encrypt("hello world");
    expect(cipher).not.toBe("hello world");
    const plain = await decrypt(cipher);
    expect(plain).toBe("hello world");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const a = await encrypt("same");
    const b = await encrypt("same");
    expect(a).not.toBe(b);
  });

  it("throws if ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(encrypt("x")).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
