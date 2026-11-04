import { describe, it, expect } from "vitest";
import { getByPath, renderTemplate, normalisePhone, collectPaths } from "./index";

describe("getByPath", () => {
  const sample = { billing: { billing_phone: "60123", addr: { city: "KL" } }, items: [{ sku: "A" }, { sku: "B" }] };
  it("resolves nested object paths", () => {
    expect(getByPath(sample, "billing.billing_phone")).toBe("60123");
    expect(getByPath(sample, "billing.addr.city")).toBe("KL");
  });
  it("resolves array index paths", () => {
    expect(getByPath(sample, "items.0.sku")).toBe("A");
    expect(getByPath(sample, "items.1.sku")).toBe("B");
  });
  it("returns undefined for missing keys", () => {
    expect(getByPath(sample, "billing.nope")).toBeUndefined();
    expect(getByPath(sample, "a.b.c.d")).toBeUndefined();
    expect(getByPath(sample, "items.9.sku")).toBeUndefined();
  });
  it("returns undefined for empty path or non-object root", () => {
    expect(getByPath(sample, "")).toBeUndefined();
    expect(getByPath("string", "a")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  const payload = { name: "Aiman", order: { id: 42, total: 99.5 }, tags: ["vip", "new"] };
  it("substitutes single and multiple variables", () => {
    expect(renderTemplate("Hi {{name}}", payload)).toBe("Hi Aiman");
    expect(renderTemplate("{{name}} #{{order.id}} = {{order.total}}", payload)).toBe("Aiman #42 = 99.5");
  });
  it("tolerates whitespace inside braces", () => {
    expect(renderTemplate("Hi {{  name  }}", payload)).toBe("Hi Aiman");
  });
  it("renders missing paths as empty string", () => {
    expect(renderTemplate("Hi {{missing.path}}!", payload)).toBe("Hi !");
  });
  it("JSON-stringifies object/array values", () => {
    expect(renderTemplate("{{tags}}", payload)).toBe('["vip","new"]');
  });
  it("leaves text without tokens untouched", () => {
    expect(renderTemplate("no tokens here", payload)).toBe("no tokens here");
  });
  it("resolves flat custom-field keys containing spaces", () => {
    expect(renderTemplate("Hi {{name}}, program {{Program Code}}", { name: "Ali", "Program Code": "DCA" })).toBe(
      "Hi Ali, program DCA",
    );
  });
  it("renders a missing custom field as empty", () => {
    expect(renderTemplate("X {{Email}}Y", { name: "A" })).toBe("X Y");
  });
  it("resolves nested {{contact.name}} against a contact payload", () => {
    expect(renderTemplate("Hi {{contact.name}} ({{contact.phone}})", { contact: { name: "Ali", phone: "60123" } })).toBe(
      "Hi Ali (60123)",
    );
  });
});

describe("normalisePhone", () => {
  it("strips formatting to bare digits", () => {
    expect(normalisePhone("+60 12-345 6789")).toBe("60123456789");
    expect(normalisePhone("(601) 234-5678")).toBe("6012345678");
  });
  it("accepts numeric input", () => {
    expect(normalisePhone(60123456789)).toBe("60123456789");
  });
  it("passes JIDs through unchanged", () => {
    expect(normalisePhone("60123@s.whatsapp.net")).toBe("60123@s.whatsapp.net");
    expect(normalisePhone("12345-678@g.us")).toBe("12345-678@g.us");
  });
  it("returns null for junk / too-short / non-string", () => {
    expect(normalisePhone("abc")).toBeNull();
    expect(normalisePhone("123")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone({})).toBeNull();
  });
});

describe("collectPaths", () => {
  it("collects leaf paths including array indices", () => {
    const paths = collectPaths({ a: { b: 1 }, c: [{ d: 2 }] });
    expect(paths).toEqual(["a.b", "c.0.d"]);
  });
  it("respects the limit", () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(collectPaths(big, 10)).toHaveLength(10);
  });
});
