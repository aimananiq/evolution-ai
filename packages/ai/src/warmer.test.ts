import { describe, it, expect } from "vitest";
import { buildWarmerPrompt, parseWarmerLines } from "./warmer";

describe("buildWarmerPrompt", () => {
  it("weaves campaign topics + guards against ad-like / name output", () => {
    const p = buildWarmerPrompt(["aiman", "oppo"], 6, "casual", {
      enabled: true,
      intensity: "moderate",
      topics: ["july diploma intake", "scholarship"],
      sampleMessages: ["Daftar diploma Julai ni!"],
    });
    expect(p).toContain("july diploma intake");
    expect(p).toMatch(/never copy/i);
    expect(p).toMatch(/NOT read like an advertisement/i);
    expect(p).toContain("Exactly 6 message");
    expect(p).toMatch(/Do NOT include the speaker names/i);
  });

  it("falls back to generic subject when no campaign", () => {
    expect(buildWarmerPrompt(["a", "b"], 4)).toContain("whatever two friends");
  });
});

describe("parseWarmerLines", () => {
  it("parses a clean JSON array", () => {
    expect(parseWarmerLines('["hi","dah makan?"]')).toEqual(["hi", "dah makan?"]);
  });
  it("handles fenced JSON", () => {
    expect(parseWarmerLines("```json\n[\"a\",\"b\"]\n```")).toEqual(["a", "b"]);
  });
  it("drops name/message-alternating arrays", () => {
    expect(parseWarmerLines('["aiman","hey there","oppo","yeah confirmed"]', ["aiman", "oppo"])).toEqual([
      "hey there",
      "yeah confirmed",
    ]);
  });
  it("strips 'Name:' speaker labels", () => {
    expect(parseWarmerLines("aiman: hey lah\noppo: dah confirmed", ["aiman", "oppo"])).toEqual(["hey lah", "dah confirmed"]);
  });
  it("does not eat legitimate commas in content", () => {
    expect(parseWarmerLines('["jom, makan","tak lapar lah"]')).toEqual(["jom, makan", "tak lapar lah"]);
  });
  it("returns null for empty", () => {
    expect(parseWarmerLines("")).toBeNull();
  });
});
