import { describe, it, expect } from "vitest";
import { parseWhatsApp, serializeWhatsApp } from "./index";

// Verify that the two round-trip divergences are IDEMPOTENT (not corruption)
// i.e. parse(output) deep-equals parse(input) — same doc structure
describe("round-trip normalisation is idempotent (not corruption)", () => {
  it("para\\n\\n-list\\n\\npara: parse output == parse input", () => {
    const input = "intro para\n\n- item one\n- item two\n\nending para";
    const output = serializeWhatsApp(parseWhatsApp(input));
    // output = "intro para\n- item one\n- item two\nending para" (normalized)
    // Both parse to the same doc structure
    expect(parseWhatsApp(output)).toEqual(parseWhatsApp(input));
    // Also confirm idempotency: serialize(parse(output)) == output
    expect(serializeWhatsApp(parseWhatsApp(output))).toBe(output);
  });

  it("para\\n-list\\n\\npara: parse output == parse input", () => {
    const input = "para\n- item\n\npara2";
    const output = serializeWhatsApp(parseWhatsApp(input));
    // output = "para\n- item\npara2"
    expect(parseWhatsApp(output)).toEqual(parseWhatsApp(input));
    expect(serializeWhatsApp(parseWhatsApp(output))).toBe(output);
  });
});
