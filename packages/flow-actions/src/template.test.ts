import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateVars } from "./template";

const vars: TemplateVars = { contact: { name: "Aisha", phone: "60123456789" }, response: "blue" };

describe("renderTemplate", () => {
  it("substitutes contact + response tokens", () => {
    expect(renderTemplate("Hi {{contact.name}} ({{contact.phone}}) — {{response}}", vars)).toBe(
      "Hi Aisha (60123456789) — blue"
    );
  });

  it("tolerates surrounding whitespace inside braces", () => {
    expect(renderTemplate("Hi {{ contact.name }}", vars)).toBe("Hi Aisha");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(renderTemplate("X{{contact.email}}Y", vars)).toBe("XY");
  });

  it("leaves text with no tokens unchanged", () => {
    expect(renderTemplate("plain text", vars)).toBe("plain text");
  });
});
