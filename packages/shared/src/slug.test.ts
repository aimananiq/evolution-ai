import { describe, it, expect } from "vitest";
import { toSlug } from "./slug";

describe("toSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(toSlug("St John's Clinic")).toBe("st-johns-clinic");
  });

  it("collapses repeated hyphens", () => {
    expect(toSlug("a  b---c")).toBe("a-b-c");
  });

  it("strips diacritics", () => {
    expect(toSlug("café")).toBe("cafe");
  });

  it("rejects empty result", () => {
    expect(() => toSlug("!!!")).toThrow(/invalid slug/i);
  });
});
