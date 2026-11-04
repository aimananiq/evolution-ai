import { describe, it, expect } from "vitest";
import { buildWaLink } from "./wa-link";

describe("buildWaLink", () => {
  it("strips non-digits and builds wa.me with encoded text", () => {
    expect(buildWaLink("+60 12-345 6789", "Hi there!")).toBe("https://wa.me/60123456789?text=Hi%20there!");
  });
  it("omits ?text when message is empty", () => {
    expect(buildWaLink("60123456789", "")).toBe("https://wa.me/60123456789");
  });
  it("throws on empty number", () => {
    expect(() => buildWaLink("", "hi")).toThrow();
  });
  it("throws on number with only non-digits", () => {
    expect(() => buildWaLink("+++---", "hi")).toThrow();
  });
  it("encodes special chars in message", () => {
    const link = buildWaLink("60123456789", "Hello & World!");
    expect(link).toBe("https://wa.me/60123456789?text=Hello%20%26%20World!");
  });
  it("omits ?text when message is undefined", () => {
    expect(buildWaLink("60123456789")).toBe("https://wa.me/60123456789");
  });
});
