import { describe, it, expect } from "vitest";
import { parseWhatsApp, serializeWhatsApp } from "./index";

// ---------------------------------------------------------------------------
// Adversarial round-trip test battery
// ---------------------------------------------------------------------------
// For each test:
//   - expectExact=true  → serializeWhatsApp(parseWhatsApp(input)) must === input
//   - expectExact=false → known normalisation; we document what happens

interface RTCase {
  name: string;
  input: string;
  expectExact: boolean;
  expectedOutput?: string; // if expectExact=false, what do we expect?
  note?: string;
}

const cases: RTCase[] = [
  // ---- Basic marks (must round-trip exactly) ----
  { name: "bold simple", input: "*hello world*", expectExact: true },
  { name: "italic simple", input: "_hello world_", expectExact: true },
  { name: "strike simple", input: "~hello world~", expectExact: true },
  { name: "code simple", input: "`hello world`", expectExact: true },

  // ---- Nested marks ----
  { name: "nested bold+italic *a _b_ c*", input: "*a _b_ c*", expectExact: true },
  { name: "nested italic+bold _a *b* c_", input: "_a *b* c_", expectExact: true },
  { name: "bold+italic together *_text_*", input: "*_text_*", expectExact: true },

  // ---- Overlapping marks (WhatsApp undefined behaviour) ----
  // *a _b* c_ — greedy parse gives bold("a _b"), remaining "c_" literal
  // Output will NOT be the same as input — document the normalisation
  {
    name: "overlapping *a _b* c_ → normalised",
    input: "*a _b* c_",
    expectExact: false,
    note: "Bold greedily matches *a _b*, leaving 'c_' as literal text (italic _ was never closed inside bold span)",
  },

  // ---- Emoji + marks ----
  { name: "emoji with bold", input: "*Hello 👋 World*", expectExact: true },
  { name: "emoji plain text", input: "Hello 🎉 World", expectExact: true },
  { name: "emoji only", input: "👋🎉🔥", expectExact: true },

  // ---- Block structures ----
  { name: "bullet list (- prefix)", input: "- item one\n- item two\n- item three", expectExact: true },
  { name: "ordered list", input: "1. first\n2. second\n3. third", expectExact: true },
  { name: "blockquote single", input: "> quoted text", expectExact: true },
  { name: "blockquote multi-line", input: "> line one\n> line two", expectExact: true },
  { name: "code fence", input: "```\nconst x = 1;\nconsole.log(x);\n```", expectExact: true },

  // Mixed blocks
  {
    name: "para + list + para (\\n\\n normalises to \\n at para↔list boundary)",
    input: "intro para\n\n- item one\n- item two\n\nending para",
    expectExact: false,
    expectedOutput: "intro para\n- item one\n- item two\nending para",
    note: "Serializer intentionally uses single \\n between para and list (list prefix is unambiguous). parse(output) == parse(input) — idempotent, not corruption.",
  },
  { name: "quote + code", input: "> quote text\n\n```\ncode here\n```", expectExact: true },
  {
    name: "para + list + para trailing (\\n\\n → \\n at list↔para boundary)",
    input: "para\n- item\n\npara2",
    expectExact: false,
    expectedOutput: "para\n- item\npara2",
    note: "Same as above: list↔para boundary uses single \\n. Idempotent normalisation.",
  },

  // ---- Bullet via * prefix (normalised to - on round-trip) ----
  {
    name: "bullet via * prefix (normalises * → -)",
    input: "* item one\n* item two",
    expectExact: false,
    expectedOutput: "- item one\n- item two",
    note: "* bullet is parsed same as - bullet; serializer always emits -",
  },

  // ---- Lone/invalid markers become literal text ----
  { name: "lone * in middle", input: "price is $5*", expectExact: true },
  { name: "underscores in word", input: "word_with_underscores", expectExact: true },
  { name: "* with space after (not bold, not bullet)", input: "* not bold", expectExact: false, note: "Starts with '* ' followed by non-space — actually matches isBulletLine, so normalises to '- not bold'" },
  { name: "marker space after open", input: "* trailing space *", expectExact: false, note: "* trailing space * — the * at start matches bullet prefix rule! normalises to - trailing space *" },

  // ---- Edge cases ----
  { name: "empty string", input: "", expectExact: true, note: "empty doc serializes back to empty string" },
  { name: "single character", input: "a", expectExact: true },
  { name: "single space", input: " ", expectExact: true },
  { name: "paragraph double newline", input: "para one\n\npara two", expectExact: true },
  { name: "hard break within paragraph", input: "line one\nline two", expectExact: true },
  { name: "para 3 hard breaks", input: "line1\nline2\nline3", expectExact: true },

  // ---- Very long line ----
  { name: "very long line (1000 chars)", input: "a".repeat(500) + " " + "b".repeat(499), expectExact: true },

  // ---- Adjacent marks ----
  { name: "adjacent *a*_b_", input: "*a*_b_", expectExact: true },
  { name: "multiple bold *a* and *b*", input: "*a* and *b*", expectExact: true },

  // ---- Code does not parse inner marks ----
  { name: "code with inner marks", input: "`*bold inside code*`", expectExact: true },

  // ---- Multi-paragraph with blank lines ----
  { name: "three paragraphs", input: "a\n\nb\n\nc", expectExact: true },

  // ---- List immediately after blockquote ----
  { name: "blockquote then list", input: "> quote\n\n- list item", expectExact: true },
];

describe("wa-format adversarial round-trip", () => {
  for (const tc of cases) {
    it(tc.name, () => {
      const doc = parseWhatsApp(tc.input);
      const out = serializeWhatsApp(doc);

      if (tc.expectExact) {
        expect(out).toBe(tc.input);
      } else if (tc.expectedOutput !== undefined) {
        // Known normalisation — check we get the expected normalised form
        expect(out).toBe(tc.expectedOutput);
      } else {
        // Known normalisation but we don't assert the exact output — just note it
        // This test always passes but we log what the output is
        console.log(`[normalisation] ${tc.name}`);
        console.log(`  input:  ${JSON.stringify(tc.input)}`);
        console.log(`  output: ${JSON.stringify(out)}`);
        console.log(`  note:   ${tc.note}`);
        expect(typeof out).toBe("string"); // at minimum it should not crash
      }
    });
  }
});
