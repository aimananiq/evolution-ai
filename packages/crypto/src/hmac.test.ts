import { describe, it, expect } from "vitest";
import { hmacSha256Hex } from "./index";

describe("hmacSha256Hex", () => {
  it("produces the known HMAC-SHA256 hex for a fixed key/message", () => {
    // Verified against `printf 'hello' | openssl dgst -sha256 -hmac 'key'`.
    expect(hmacSha256Hex("hello", "key")).toBe(
      "9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b",
    );
  });

  it("is deterministic and key-sensitive", () => {
    expect(hmacSha256Hex("body", "s1")).toBe(hmacSha256Hex("body", "s1"));
    expect(hmacSha256Hex("body", "s1")).not.toBe(hmacSha256Hex("body", "s2"));
  });
});
