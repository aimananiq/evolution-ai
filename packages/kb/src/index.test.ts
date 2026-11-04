import { describe, it, expect } from "vitest";
import { retrieveContext, type KbSnippet } from "./index";

const snippets: KbSnippet[] = [
  { id: "1", title: "Opening hours", content: "We are open Monday to Friday, 9am to 6pm." },
  { id: "2", title: "Refund policy", content: "Refunds are available within 14 days of purchase." },
  { id: "3", title: "Delivery", content: "Standard delivery takes 3 to 5 working days nationwide." },
];

describe("retrieveContext", () => {
  it("returns matching snippets ranked by relevance", () => {
    const { used, block } = retrieveContext("what are your refund rules?", snippets);
    expect(used[0]!.id).toBe("2");
    expect(block).toContain("Refund policy");
    expect(block).toContain("14 days");
  });

  it("weights title matches above content matches", () => {
    // "delivery" appears in snippet 3's title; "days" appears in 2 and 3's content.
    const { used } = retrieveContext("delivery time in days", snippets);
    expect(used[0]!.id).toBe("3");
  });

  it("returns an empty block when nothing matches", () => {
    const { used, block } = retrieveContext("do you sell bicycles?", snippets);
    expect(used).toHaveLength(0);
    expect(block).toBe("");
  });

  it("returns an empty block for an empty or whitespace query", () => {
    expect(retrieveContext("", snippets).block).toBe("");
    expect(retrieveContext("   ", snippets).block).toBe("");
  });

  it("ignores stopwords and very short tokens", () => {
    // Only stopwords/short tokens — no real signal — so no match.
    const { block } = retrieveContext("is it to be or", snippets);
    expect(block).toBe("");
  });

  it("omits the general-knowledge preamble when bare is true", () => {
    const withPreamble = retrieveContext("what are your refund rules?", snippets).block;
    const bare = retrieveContext("what are your refund rules?", snippets, { bare: true }).block;
    expect(withPreamble).toContain("rely on general knowledge");
    expect(bare).not.toContain("rely on general knowledge");
    // The bare block is exactly the joined snippet lines.
    expect(bare).toContain("Refund policy");
    expect(bare).toContain("14 days");
    expect(bare.startsWith("- ")).toBe(true);
  });

  it("respects the limit and clamps long content", () => {
    const long: KbSnippet[] = [
      { id: "a", title: "hours", content: "open " + "x".repeat(2000) },
      { id: "b", title: "hours", content: "open " + "y".repeat(2000) },
      { id: "c", title: "hours", content: "open " + "z".repeat(2000) },
      { id: "d", title: "hours", content: "open " + "w".repeat(2000) },
    ];
    const { used, block } = retrieveContext("hours open", long, { limit: 2, maxCharsPerSnippet: 50 });
    expect(used).toHaveLength(2);
    // each clamped snippet contributes at most ~50 chars of content
    expect(block.length).toBeLessThan(300);
  });
});
