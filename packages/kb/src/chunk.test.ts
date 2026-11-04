import { describe, it, expect } from "vitest";
import { chunkDocument, chunkText, estimateTokens, meterTier } from "./chunk";

describe("chunkDocument", () => {
  it("splits on markdown headings, using the heading as the title", () => {
    const doc = `# Opening hours\nMon-Fri 9-6.\n\n## Refunds\nWithin 14 days.`;
    const { chunks } = chunkDocument(doc);
    expect(chunks).toEqual([
      { title: "Opening hours", content: "Mon-Fri 9-6." },
      { title: "Refunds", content: "Within 14 days." },
    ]);
  });

  it("titles preamble before the first heading from baseTitle", () => {
    const doc = `Welcome to Acme.\n\n# Hours\n9-6`;
    const { chunks } = chunkDocument(doc, { baseTitle: "Acme" });
    expect(chunks[0]).toEqual({ title: "Acme (1)", content: "Welcome to Acme." });
    expect(chunks[1]).toEqual({ title: "Hours", content: "9-6" });
  });

  it("packs paragraphs up to maxChars when there are no headings", () => {
    const doc = `${"a".repeat(30)}\n\n${"b".repeat(30)}\n\n${"c".repeat(30)}`;
    const { chunks } = chunkDocument(doc, { baseTitle: "Doc", maxChars: 70 });
    // 30 + 2 + 30 = 62 fits; adding c (>70) starts a new chunk.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.title).toBe("Doc (1)");
    expect(chunks[1]!.title).toBe("Doc (2)");
  });

  it("returns a single unnumbered baseTitle chunk for short heading-less text", () => {
    const { chunks } = chunkDocument("Just one short note.", { baseTitle: "Note" });
    expect(chunks).toEqual([{ title: "Note", content: "Just one short note." }]);
  });

  it("repacks an oversized heading section into numbered parts keeping the heading", () => {
    const doc = `# Policy\n${"x".repeat(50)}\n\n${"y".repeat(50)}`;
    const { chunks } = chunkDocument(doc, { maxChars: 60 });
    expect(chunks.map((c) => c.title)).toEqual(["Policy (1)", "Policy (2)"]);
  });

  it("returns no chunks for empty or whitespace input", () => {
    expect(chunkDocument("").chunks).toHaveLength(0);
    expect(chunkDocument("   \n  \n").chunks).toHaveLength(0);
  });

  it("caps at maxChunks and reports truncation", () => {
    const doc = Array.from({ length: 10 }, (_, i) => `# H${i}\nbody ${i}`).join("\n\n");
    const { chunks, truncated } = chunkDocument(doc, { maxChunks: 4 });
    expect(chunks).toHaveLength(4);
    expect(truncated).toBe(true);
  });

  it("clamps very long titles to 120 chars", () => {
    const doc = `# ${"T".repeat(200)}\nbody`;
    const { chunks } = chunkDocument(doc);
    expect(chunks[0]!.title.length).toBe(120);
  });
});

describe("chunkText", () => {
  it("splits long text into ~maxChars chunks on paragraph/sentence bounds", () => {
    const para = "Sentence one. Sentence two. ".repeat(100);
    const chunks = chunkText(para, 800);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(1000);
    expect(chunks.join(" ").replace(/\s+/g, "")).toContain("Sentenceone");
  });
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world", 800)).toEqual(["hello world"]);
  });
  it("drops empty input", () => {
    expect(chunkText("   ", 800)).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("meterTier", () => {
  it("green < 30k tokens, amber < 120k, red beyond", () => {
    expect(meterTier(10_000)).toBe("green");
    expect(meterTier(60_000)).toBe("amber");
    expect(meterTier(200_000)).toBe("red");
  });
});
