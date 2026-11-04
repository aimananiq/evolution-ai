import { describe, it, expect } from "vitest";
import { parseWhatsApp, serializeWhatsApp } from "./index";
import type { WaDoc, WaBlock, WaInline, WaText, WaHardBreak } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert the two directions of a round-trip */
function assertRoundTrip(text: string, doc: WaDoc) {
  expect(parseWhatsApp(text)).toEqual(doc);
  expect(serializeWhatsApp(doc)).toBe(text);
}

function para(content: (WaBlock | WaInline)[]): WaBlock {
  return { type: "paragraph", content };
}

function text(t: string): WaText {
  return { type: "text", text: t };
}

function bold(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "bold" }] };
}

function italic(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "italic" }] };
}

function strike(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "strike" }] };
}

function code(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "code" }] };
}

const hardBreak: WaHardBreak = { type: "hardBreak" };

function doc(...blocks: WaBlock[]): WaDoc {
  return { type: "doc", content: blocks };
}

// ---------------------------------------------------------------------------
// 1. Plain text
// ---------------------------------------------------------------------------

describe("plain text", () => {
  it("converts plain text to a single paragraph with one text node", () => {
    const input = "Hello world";
    const expected = doc(para([text("Hello world")]));
    assertRoundTrip(input, expected);
  });

  it("empty string produces doc with one empty paragraph", () => {
    const input = "";
    const expected = doc(para([text("")]));
    assertRoundTrip(input, expected);
  });
});

// ---------------------------------------------------------------------------
// 2. Inline marks — each individually
// ---------------------------------------------------------------------------

describe("inline marks", () => {
  it("*bold* → bold mark; round-trips", () => {
    assertRoundTrip("*bold*", doc(para([bold("bold")])));
  });

  it("_italic_ → italic mark; round-trips", () => {
    assertRoundTrip("_italic_", doc(para([italic("italic")])));
  });

  it("~strike~ → strike mark; round-trips", () => {
    assertRoundTrip("~strike~", doc(para([strike("strike")])));
  });

  it("`mono` → code mark; round-trips", () => {
    assertRoundTrip("`mono`", doc(para([code("mono")])));
  });

  it("marks wrapped around multi-word text preserve spaces inside", () => {
    assertRoundTrip("*hello world*", doc(para([bold("hello world")])));
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed inline in one line
// ---------------------------------------------------------------------------

describe("mixed inline", () => {
  it("Hi *there* _friend_ produces correct marks sequence", () => {
    const expected = doc(
      para([text("Hi "), bold("there"), text(" "), italic("friend")])
    );
    assertRoundTrip("Hi *there* _friend_", expected);
  });

  it("leading and trailing plain text with mark in middle", () => {
    const expected = doc(
      para([text("say "), bold("this"), text(" now")])
    );
    assertRoundTrip("say *this* now", expected);
  });

  it("adjacent marks without spaces", () => {
    // WhatsApp allows *bold*_italic_ adjacently (no space between)
    const expected = doc(
      para([bold("a"), italic("b")])
    );
    assertRoundTrip("*a*_b_", expected);
  });
});

// ---------------------------------------------------------------------------
// 4. Literal lone markers (no matching close) stay literal
// ---------------------------------------------------------------------------

describe("literal markers (no matching close)", () => {
  it("lone * stays literal; serializes back to *", () => {
    const input = "price is * great";
    const expected = doc(para([text("price is * great")]));
    assertRoundTrip(input, expected);
  });

  it("lone _ stays literal", () => {
    assertRoundTrip("a _ b", doc(para([text("a _ b")])));
  });

  it("lone ~ stays literal", () => {
    assertRoundTrip("a ~ b", doc(para([text("a ~ b")])));
  });

  it("lone backtick stays literal", () => {
    assertRoundTrip("a ` b", doc(para([text("a ` b")])));
  });

  it("marker around space-only content stays literal (WA requires non-empty inner)", () => {
    // "_ _" — bold/italic marker wrapping a single space → inner is space-only → literal
    assertRoundTrip("_ _", doc(para([text("_ _")])));
  });

  it("* * is a bullet list with content '*' (disambiguation: '* ' at line start is always bullet)", () => {
    // Disambiguation: "* " at line start with non-space content is always a bullet.
    // "* *" → bulletList with item "*". Serialises back as "- *".
    // This is the documented normalisation: "* " bullet → "- " on output.
    const result = parseWhatsApp("* *");
    expect(result).toEqual(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [para([text("*")])] }],
      })
    );
    expect(serializeWhatsApp(result)).toBe("- *");
  });

  it("* at line start followed by space is a bullet list, not a literal * mark", () => {
    // "* item" → bulletList (not a paragraph with literal *)
    // Normalisation: "* " bullet prefix serialises back as "- " (canonical form).
    // So "* item" does NOT round-trip to "* item" — it normalises to "- item".
    const result = parseWhatsApp("* item");
    expect(result).toEqual(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [para([text("item")])],
          },
        ],
      })
    );
    // The serialization is "- item" (canonical prefix), NOT "* item"
    expect(serializeWhatsApp(result)).toBe("- item");
  });
});

// ---------------------------------------------------------------------------
// 5. Bullet list
// ---------------------------------------------------------------------------

describe("bullet list", () => {
  it("- a\\n- b → bulletList with 2 items; round-trips", () => {
    const expected = doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [para([text("a")])] },
        { type: "listItem", content: [para([text("b")])] },
      ],
    });
    assertRoundTrip("- a\n- b", expected);
  });

  it("* item syntax also produces bulletList; serializes as '- '", () => {
    // canonical serialize form is "- " (normalised), so the round-trip
    // for the text "* item" goes through doc and back to "- item"
    const doc1 = parseWhatsApp("* item");
    expect(doc1).toEqual(
      doc({
        type: "bulletList",
        content: [{ type: "listItem", content: [para([text("item")])] }],
      })
    );
    // serializeWhatsApp chooses "- " as the canonical prefix
    expect(serializeWhatsApp(doc1)).toBe("- item");
  });

  it("bullet items can contain inline marks", () => {
    const expected = doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [para([bold("a")])] },
        { type: "listItem", content: [para([text("b")])] },
      ],
    });
    assertRoundTrip("- *a*\n- b", expected);
  });
});

// ---------------------------------------------------------------------------
// 6. Ordered list
// ---------------------------------------------------------------------------

describe("ordered list", () => {
  it("1. a\\n2. b → orderedList with 2 items; round-trips", () => {
    const expected = doc({
      type: "orderedList",
      content: [
        { type: "listItem", content: [para([text("a")])] },
        { type: "listItem", content: [para([text("b")])] },
      ],
    });
    assertRoundTrip("1. a\n2. b", expected);
  });

  it("ordered list serializes with consecutive numbering starting at 1", () => {
    const d = doc({
      type: "orderedList",
      content: [
        { type: "listItem", content: [para([text("first")])] },
        { type: "listItem", content: [para([text("second")])] },
        { type: "listItem", content: [para([text("third")])] },
      ],
    });
    expect(serializeWhatsApp(d)).toBe("1. first\n2. second\n3. third");
  });
});

// ---------------------------------------------------------------------------
// 7. Blockquote
// ---------------------------------------------------------------------------

describe("blockquote", () => {
  it("> hi\\n> there → one blockquote with hardBreak; round-trips", () => {
    const expected = doc({
      type: "blockquote",
      content: [text("hi"), hardBreak, text("there")],
    });
    assertRoundTrip("> hi\n> there", expected);
  });

  it("single > line → blockquote without hardBreak", () => {
    const expected = doc({
      type: "blockquote",
      content: [text("hello")],
    });
    assertRoundTrip("> hello", expected);
  });

  it("blockquote lines can contain inline marks", () => {
    const expected = doc({
      type: "blockquote",
      content: [bold("hi")],
    });
    assertRoundTrip("> *hi*", expected);
  });
});

// ---------------------------------------------------------------------------
// 8. Multi-paragraph (blank line) and in-paragraph newline (hardBreak)
// ---------------------------------------------------------------------------

describe("paragraphs and hard breaks", () => {
  it("blank line separates two paragraphs; round-trips", () => {
    const expected = doc(
      para([text("first")]),
      para([text("second")])
    );
    assertRoundTrip("first\n\nsecond", expected);
  });

  it("single newline inside paragraph → hardBreak; round-trips", () => {
    const expected = doc(
      para([text("line one"), hardBreak, text("line two")])
    );
    assertRoundTrip("line one\nline two", expected);
  });

  it("three paragraphs separated by blank lines; round-trips", () => {
    const expected = doc(
      para([text("a")]),
      para([text("b")]),
      para([text("c")])
    );
    assertRoundTrip("a\n\nb\n\nc", expected);
  });

  it("paragraph with inline marks and hard break; round-trips", () => {
    const expected = doc(
      para([bold("hi"), hardBreak, italic("there")])
    );
    assertRoundTrip("*hi*\n_there_", expected);
  });
});

// ---------------------------------------------------------------------------
// 9. Code block fence
// ---------------------------------------------------------------------------

describe("code block", () => {
  it("``` fenced block round-trips with inner content untouched", () => {
    const input = "```\nconsole.log('hello')\n```";
    const expected = doc({
      type: "codeBlock",
      content: [text("console.log('hello')")],
    });
    assertRoundTrip(input, expected);
  });

  it("code block inner content is NOT parsed for inline marks", () => {
    const input = "```\n*not bold* _not italic_\n```";
    const expected = doc({
      type: "codeBlock",
      content: [text("*not bold* _not italic_")],
    });
    assertRoundTrip(input, expected);
  });

  it("code block with multiple inner lines uses \\n as join (no hardBreak nodes)", () => {
    const input = "```\nline1\nline2\n```";
    const expected = doc({
      type: "codeBlock",
      content: [text("line1\nline2")],
    });
    assertRoundTrip(input, expected);
  });

  it("empty code block", () => {
    const input = "```\n```";
    const expected = doc({
      type: "codeBlock",
      content: [text("")],
    });
    assertRoundTrip(input, expected);
  });
});

// ---------------------------------------------------------------------------
// 10. Idempotency
// ---------------------------------------------------------------------------

describe("idempotency — applying twice == applying once", () => {
  const cases: string[] = [
    "Hello world",
    "*bold*",
    "_italic_",
    "~strike~",
    "`mono`",
    "Hi *there* _friend_",
    "price is * great",
    "- a\n- b",
    "1. a\n2. b",
    "> hi\n> there",
    "first\n\nsecond",
    "line one\nline two",
    "```\nconsole.log('hi')\n```",
  ];

  for (const input of cases) {
    it(`serialize(parse(serialize(parse(x)))) == serialize(parse(x)) for: ${JSON.stringify(input)}`, () => {
      const once = serializeWhatsApp(parseWhatsApp(input));
      const twice = serializeWhatsApp(parseWhatsApp(once));
      expect(twice).toBe(once);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. Doc → text → doc round-trip (the other direction)
// ---------------------------------------------------------------------------

describe("doc → text → doc round-trip", () => {
  it("a fully constructed doc survives text serialization and re-parsing", () => {
    const original = doc(
      para([text("Hello "), bold("world")]),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [para([text("item")])] },
        ],
      }
    );
    const serialized = serializeWhatsApp(original);
    const reparsed = parseWhatsApp(serialized);
    expect(reparsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// 12. Edge cases — disambiguation
// ---------------------------------------------------------------------------

// Helper for multi-mark text nodes
function boldItalic(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "bold" }, { type: "italic" }] };
}
function boldItalicStrike(t: string): WaText {
  return { type: "text", text: t, marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }] };
}

describe("edge cases", () => {
  it("*bold* at start of line is NOT a bullet list (no trailing space)", () => {
    // "* item" is a bullet; "*bold*" is a mark. Disambiguated by the space.
    expect(parseWhatsApp("*bold*")).toEqual(doc(para([bold("bold")])));
  });

  it("marker characters inside code spans are literal", () => {
    // "`*not bold*`" → code mark, inner text is literal "*not bold*"
    assertRoundTrip("`*not bold*`", doc(para([code("*not bold*")])));
  });

  it("overlapping markers do not nest — first opening wins", () => {
    // "*foo _bar* baz_" → bold("foo _bar"), text(" baz_")
    // The _ inside the bold span has no closing _ before the *-close,
    // so the _ is treated literally inside the bold span
    const result = parseWhatsApp("*foo _bar* baz_");
    // The bold span covers "foo _bar"; " baz_" is plain text
    expect(result).toEqual(
      doc(para([bold("foo _bar"), text(" baz_")]))
    );
  });

  it("marker at the very end of line with no closing stays literal", () => {
    assertRoundTrip("hello *", doc(para([text("hello *")])));
  });

  it("mixed blocks: paragraph, then bullet list, then paragraph", () => {
    // NOTE: "intro\n\n- item\n\noutro" and "intro\n- item\noutro" parse to the
    // same doc (both become para + bulletList + para).  The canonical
    // serialization uses a single "\n" at para↔list boundaries (no blank
    // line), so the round-trip text is "intro\n- item\noutro".
    // The old test used "\n\n" which encoded the buggy blank-line behaviour;
    // updated per fix(wa-format) bug-2 correction.
    const input = "intro\n- item\noutro";
    const expected = doc(
      para([text("intro")]),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [para([text("item")])] }],
      },
      para([text("outro")])
    );
    assertRoundTrip(input, expected);
  });
});

// ---------------------------------------------------------------------------
// 13. Nested / overlapping inline marks (Bug 1 regression tests)
// ---------------------------------------------------------------------------

describe("nested inline marks", () => {
  it("*bold _nested_* round-trips exactly (both directions)", () => {
    // Parse: bold wraps "bold " and "nested"; italic wraps only "nested"
    const expected = doc(
      para([
        { type: "text", text: "bold ", marks: [{ type: "bold" }] },
        { type: "text", text: "nested", marks: [{ type: "bold" }, { type: "italic" }] },
      ])
    );
    assertRoundTrip("*bold _nested_*", expected);
  });

  it("*bold _italic_ end* round-trips exactly", () => {
    // "bold " → bold only; "italic" → bold+italic; " end" → bold only
    const expected = doc(
      para([
        { type: "text", text: "bold ", marks: [{ type: "bold" }] },
        { type: "text", text: "italic", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: " end", marks: [{ type: "bold" }] },
      ])
    );
    assertRoundTrip("*bold _italic_ end*", expected);
  });

  it("_italic *bold* end_ round-trips exactly", () => {
    // "italic " → italic only; "bold" → italic+bold; " end" → italic only
    const expected = doc(
      para([
        { type: "text", text: "italic ", marks: [{ type: "italic" }] },
        { type: "text", text: "bold", marks: [{ type: "italic" }, { type: "bold" }] },
        { type: "text", text: " end", marks: [{ type: "italic" }] },
      ])
    );
    assertRoundTrip("_italic *bold* end_", expected);
  });

  it("all-marks run {bold,italic,strike} serializes to stable nesting and parses back", () => {
    // Canonical order: bold > italic > strike  →  *_~all~_*
    const allMarks = boldItalicStrike("all");
    const serialized = serializeWhatsApp(doc(para([allMarks])));
    // Must serialize to properly nested markers in canonical order
    expect(serialized).toBe("*_~all~_*");
    // And parse back to the same mark set (order in marks array may vary; check set equality)
    const reparsed = parseWhatsApp(serialized);
    const node = (reparsed.content[0] as WaBlock).content![0] as WaText;
    expect(node.text).toBe("all");
    const types = new Set(node.marks?.map((m) => m.type) ?? []);
    expect(types).toEqual(new Set(["bold", "italic", "strike"]));
  });

  it("code mark is exclusive — other marks on same node are suppressed in output", () => {
    // A node with {bold, code} should serialize as `text` (code wins, bold suppressed)
    const nodeWithCodeAndBold: WaText = {
      type: "text",
      text: "mono",
      marks: [{ type: "bold" }, { type: "code" }],
    };
    const serialized = serializeWhatsApp(doc(para([nodeWithCodeAndBold])));
    expect(serialized).toBe("`mono`");
  });

  it("Use `code` and *bold _nested_* round-trips exactly", () => {
    const r = serializeWhatsApp(parseWhatsApp("Use `code` and *bold _nested_*"));
    expect(r).toBe("Use `code` and *bold _nested_*");
  });
});

// ---------------------------------------------------------------------------
// 14. Block separator — paragraph ↔ list spacing (Bug 2 regression tests)
// ---------------------------------------------------------------------------

describe("block separator spacing", () => {
  it("paragraph then bulletList uses single \\n (no blank line)", () => {
    // "Choose:\n- Pizza\n- Pasta" must round-trip exactly
    assertRoundTrip(
      "Choose:\n- Pizza\n- Pasta",
      doc(
        para([text("Choose:")]),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [para([text("Pizza")])] },
            { type: "listItem", content: [para([text("Pasta")])] },
          ],
        }
      )
    );
  });

  it("bulletList then paragraph uses single \\n (no blank line)", () => {
    // "- a\n- b\nplain" must round-trip exactly
    assertRoundTrip(
      "- a\n- b\nplain",
      doc(
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [para([text("a")])] },
            { type: "listItem", content: [para([text("b")])] },
          ],
        },
        para([text("plain")])
      )
    );
  });

  it("paragraph then paragraph still uses double \\n\\n (blank line)", () => {
    assertRoundTrip(
      "first\n\nsecond",
      doc(para([text("first")]), para([text("second")]))
    );
  });
});
