// @evo/wa-format — WhatsApp text ↔ TipTap/ProseMirror JSON
//
// Everything lives in a single file (no re-exported sub-modules) to avoid
// the `export * from './relative'` collapsing bug in the tsx runtime used by
// apps/ingest/worker.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaMark {
  type: "bold" | "italic" | "strike" | "code";
}

export interface WaText {
  type: "text";
  text: string;
  marks?: WaMark[];
}

export interface WaHardBreak {
  type: "hardBreak";
}

export type WaInline = WaText | WaHardBreak;

export interface WaBlock {
  type:
    | "paragraph"
    | "blockquote"
    | "codeBlock"
    | "bulletList"
    | "orderedList"
    | "listItem";
  content?: (WaBlock | WaInline)[];
}

export interface WaDoc {
  type: "doc";
  content: WaBlock[];
}

// ---------------------------------------------------------------------------
// Inline-mark tokeniser
// ---------------------------------------------------------------------------
//
// WhatsApp inline-mark rules (applied per-line, except inside code blocks):
//   *text*   → bold      (marker = *)
//   _text_   → italic    (marker = _)
//   ~text~   → strike    (marker = ~)
//   `text`   → code      (marker = `)
//
// Disambiguation:
//   - A mark pair is only recognised when:
//       1. The opening marker is immediately followed by a non-space character.
//       2. The closing marker is immediately preceded by a non-space character.
//       3. The inner text is non-empty.
//       4. Both markers are on the same "segment" (no cross-line spans here;
//          lines are processed individually).
//   - `*` at the very start of a line followed by a space is a bullet prefix
//     and is stripped before inline parsing, so it never reaches this code.
//   - Code-span content is NOT further parsed for marks.

const MARK_CHAR: Record<string, WaMark["type"]> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
  "`": "code",
};

const MARK_SERIALIZE: Record<WaMark["type"], string> = {
  bold: "*",
  italic: "_",
  strike: "~",
  code: "`",
};

/**
 * Parse a single line of text (no newlines) into WaInline nodes.
 * Does NOT insert hardBreak nodes — that's done by the block-level logic.
 */
function parseInline(line: string): WaInline[] {
  const nodes: WaInline[] = [];

  let i = 0;
  let pending = ""; // plain text accumulator

  function flushPending(mark?: WaMark, forceFlush = false) {
    if (pending || forceFlush) {
      const node: WaText = { type: "text", text: pending };
      if (mark) node.marks = [mark];
      nodes.push(node);
      pending = "";
    }
  }

  while (i < line.length) {
    const ch = line[i]!;

    if (ch in MARK_CHAR) {
      const markType = MARK_CHAR[ch]!;
      // Try to find a valid closing marker
      // Opening: ch at position i, next char must be non-space and non-empty
      const afterOpen = line[i + 1];
      if (afterOpen !== undefined && afterOpen !== " " && afterOpen !== ch) {
        // Search for a closing marker (not preceded by space)
        let j = i + 2; // at minimum one char between markers
        let found = -1;
        while (j < line.length) {
          if (line[j] === ch && line[j - 1] !== " ") {
            // For non-backtick marks, skip if this is another marker of the
            // same type immediately (e.g. avoid matching ** as empty span)
            found = j;
            break;
          }
          j++;
        }
        if (found !== -1) {
          const inner = line.slice(i + 1, found);
          // inner must be non-empty (already guaranteed by j >= i+2)
          flushPending();
          // For code, no further inline parsing inside
          if (markType === "code") {
            nodes.push({ type: "text", text: inner, marks: [{ type: "code" }] });
          } else {
            // Recursively parse the inner text for nested marks
            const innerNodes = parseInline(inner);
            const mark: WaMark = { type: markType };
            for (const n of innerNodes) {
              if (n.type === "text") {
                const node: WaText = { type: "text", text: n.text };
                // Merge outer mark with any existing marks (outer wins positionally)
                if (n.marks && n.marks.length > 0) {
                  node.marks = [mark, ...n.marks];
                } else {
                  node.marks = [mark];
                }
                nodes.push(node);
              } else {
                nodes.push(n);
              }
            }
          }
          i = found + 1;
          continue;
        }
      }
      // No valid closing marker found → treat as literal
      pending += ch;
      i++;
    } else {
      pending += ch;
      i++;
    }
  }

  // Force-flush even if pending is "" so that an empty line produces a text("") node
  flushPending(undefined, nodes.length === 0);
  return nodes;
}

// ---------------------------------------------------------------------------
// parseWhatsApp
// ---------------------------------------------------------------------------

/**
 * Convert WhatsApp-formatted text to a TipTap/ProseMirror JSON document.
 *
 * Normalisation decisions:
 *   - `* item` (bullet via `* `) serialises back as `- item` (canonical
 *     bullet prefix is `- `). Documented here so callers are aware.
 *   - Trailing newlines in the source are stripped before parsing.
 *   - Consecutive bullet lines collapse into one bulletList node.
 *   - Consecutive ordered-list lines collapse into one orderedList node.
 *   - Consecutive `> ` lines collapse into one blockquote with hardBreak
 *     between them.
 *   - A blank line (`\n\n`) separates paragraph-level blocks.
 *   - A single `\n` inside a paragraph-level block inserts a hardBreak.
 *   - Lines inside a ``` fence are joined with `\n` into a single text node;
 *     no inline mark parsing occurs.
 */
export function parseWhatsApp(text: string): WaDoc {
  // Normalise: strip trailing newline(s) so we don't get spurious empty blocks
  const src = text.replace(/\n+$/, "");

  const blocks: WaBlock[] = [];

  // Split into "segments" separated by blank lines (\n\n).
  // Each segment is processed as a unit.
  const segments = src === "" ? [""] : src.split(/\n\n+/);

  for (const segment of segments) {
    const lines = segment.split("\n");
    processSegment(lines, blocks);
  }

  return { type: "doc", content: blocks };
}

function processSegment(lines: string[], out: WaBlock[]): void {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // ---- Code block fence ----
    if (line === "```") {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i] !== "```") {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      out.push({
        type: "codeBlock",
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // ---- Blockquote lines: collect consecutive > prefixed lines ----
    if (line.startsWith("> ")) {
      const bqContent: (WaInline)[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        if (bqContent.length > 0) {
          bqContent.push({ type: "hardBreak" });
        }
        const innerLine = lines[i]!.slice(2);
        bqContent.push(...parseInline(innerLine));
        i++;
      }
      out.push({ type: "blockquote", content: bqContent });
      continue;
    }

    // ---- Bullet list: collect consecutive "- " or "* " lines ----
    if (isBulletLine(line)) {
      const items: WaBlock[] = [];
      while (i < lines.length && isBulletLine(lines[i]!)) {
        const innerLine = bulletContent(lines[i]!);
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(innerLine) }],
        });
        i++;
      }
      out.push({ type: "bulletList", content: items });
      continue;
    }

    // ---- Ordered list: collect consecutive "N. " lines ----
    if (isOrderedLine(line)) {
      const items: WaBlock[] = [];
      while (i < lines.length && isOrderedLine(lines[i]!)) {
        const innerLine = orderedContent(lines[i]!);
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(innerLine) }],
        });
        i++;
      }
      out.push({ type: "orderedList", content: items });
      continue;
    }

    // ---- Paragraph: collect consecutive plain lines (within a segment,
    //      separated by \n rather than \n\n) joined by hardBreak ----
    const paraContent: WaInline[] = [];
    while (
      i < lines.length &&
      !isBulletLine(lines[i]!) &&
      !isOrderedLine(lines[i]!) &&
      !lines[i]!.startsWith("> ") &&
      lines[i] !== "```"
    ) {
      if (paraContent.length > 0) {
        paraContent.push({ type: "hardBreak" });
      }
      paraContent.push(...parseInline(lines[i]!));
      i++;
    }
    out.push({ type: "paragraph", content: paraContent });
  }
}

function isBulletLine(line: string): boolean {
  // Must be "- " or "* " followed by at least one non-space character.
  // "* *" has a space as the second char of content and does NOT match "* " bullet
  // because the content after "* " is just " *" which does start with a space...
  // Actually regex: the char after "- "/"* " must be non-space.
  return /^[*-] \S/.test(line);
}

function bulletContent(line: string): string {
  return line.slice(2);
}

function isOrderedLine(line: string): boolean {
  return /^\d+\. /.test(line);
}

function orderedContent(line: string): string {
  return line.replace(/^\d+\. /, "");
}

// ---------------------------------------------------------------------------
// serializeWhatsApp
// ---------------------------------------------------------------------------

/**
 * Convert a TipTap/ProseMirror WaDoc back to WhatsApp-formatted text.
 *
 * Block separator rules (matching WhatsApp's disambiguation model):
 *   - paragraph  ↔  bulletList/orderedList : "\n"   — list prefix is unambiguous
 *   - bulletList ↔  orderedList            : "\n"   — both list prefixes are unambiguous
 *   - paragraph  ↔  paragraph              : "\n\n" — blank line required to separate paragraphs
 *   - anything involving blockquote/codeBlock: "\n\n" — safe default; bq/code are
 *     already distinctive but surrounding context may be ambiguous
 *
 * Rationale: a single "\n" between a paragraph and a list is sufficient because
 * "- " / "N. " / "> " line-starts cannot occur in paragraph content.  Between
 * two consecutive paragraphs a blank line is the only reliable separator.
 */
export function serializeWhatsApp(doc: WaDoc): string {
  const blocks = doc.content;
  if (blocks.length === 0) return "";
  const parts: string[] = blocks.map(serializeBlock);
  const result: string[] = [parts[0]!];
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1]!.type;
    const curr = blocks[i]!.type;
    const listTypes = new Set<string>(["bulletList", "orderedList"]);
    // Single \n between paragraph and list (either direction) or between two list types.
    const singleNewline =
      (prev === "paragraph" && listTypes.has(curr)) ||
      (listTypes.has(prev) && curr === "paragraph") ||
      (listTypes.has(prev) && listTypes.has(curr));
    result.push(singleNewline ? "\n" : "\n\n", parts[i]!);
  }
  return result.join("");
}

function serializeBlock(block: WaBlock): string {
  switch (block.type) {
    case "paragraph":
      return serializeInlineContent(block.content ?? []);

    case "blockquote": {
      // content is a flat list of WaInline nodes with hardBreak separators
      const content = block.content ?? [];
      const parts: string[] = [];
      let current: WaInline[] = [];
      for (const node of content) {
        if (node.type === "hardBreak") {
          parts.push("> " + serializeInlineContent(current));
          current = [];
        } else {
          current.push(node as WaInline);
        }
      }
      if (current.length > 0 || parts.length === 0) {
        parts.push("> " + serializeInlineContent(current));
      }
      return parts.join("\n");
    }

    case "codeBlock": {
      const inner = serializeInlineContent(block.content ?? []);
      // Empty code block: "```\n```" (no extra newline)
      if (inner === "") return "```\n```";
      return "```\n" + inner + "\n```";
    }

    case "bulletList": {
      return (block.content ?? [])
        .map((item) => {
          const li = item as WaBlock;
          const innerPara = (li.content ?? [])[0] as WaBlock | undefined;
          const inner = innerPara ? serializeInlineContent(innerPara.content ?? []) : "";
          return "- " + inner;
        })
        .join("\n");
    }

    case "orderedList": {
      return (block.content ?? [])
        .map((item, idx) => {
          const li = item as WaBlock;
          const innerPara = (li.content ?? [])[0] as WaBlock | undefined;
          const inner = innerPara ? serializeInlineContent(innerPara.content ?? []) : "";
          return `${idx + 1}. ` + inner;
        })
        .join("\n");
    }

    case "listItem": {
      // Should not appear at top level but handle gracefully
      const innerPara = (block.content ?? [])[0] as WaBlock | undefined;
      return innerPara ? serializeBlock(innerPara) : "";
    }

    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Inline serializer — mark open/close tracking
// ---------------------------------------------------------------------------
//
// WhatsApp mark nesting model: a mark wraps a *contiguous range* of text.
// When adjacent text nodes share an outer mark, we keep that marker OPEN
// across the boundary and only emit open/close events where a mark actually
// starts or ends.
//
// Deterministic mark order (outer → inner):  bold, italic, strike, code
// "code" is exclusive: when present, other marks are ignored because
// WhatsApp monospace does not combine with bold/italic/strike.
//
// Algorithm (per-boundary):
//   1. Compute `openSet` (marks on current node) and `prevSet` (marks on
//      previous node).
//   2. Marks to CLOSE = prevSet ∖ openSet  (emit closing marker in
//      reverse-open order so nesting is proper).
//   3. Marks to OPEN  = openSet ∖ prevSet  (emit opening marker in
//      canonical order).
//   This is the standard ProseMirror mark-range algorithm adapted for
//   flat text-node lists.

/** Canonical ordering for mark types (index = nesting depth, 0 = outermost). */
const MARK_ORDER: WaMark["type"][] = ["bold", "italic", "strike", "code"];

function markOrder(type: WaMark["type"]): number {
  return MARK_ORDER.indexOf(type);
}

/** Extract the set of mark types from a WaText node (empty set if none). */
function markSet(node: WaText): Set<WaMark["type"]> {
  if (!node.marks || node.marks.length === 0) return new Set();
  // If code is present, it is exclusive — suppress all other marks.
  const types = node.marks.map((m) => m.type);
  if (types.includes("code")) return new Set(["code"]);
  return new Set(types);
}

function serializeInlineContent(content: (WaBlock | WaInline)[]): string {
  // We need to handle mark open/close across adjacent text nodes.
  // Strategy: flatten to a list of "events" then join.

  // Collect text-node refs (hardBreaks are handled separately)
  const parts: string[] = [];

  // Track which marks are currently open (in the order they were opened).
  let openStack: WaMark["type"][] = []; // outermost first

  // Helper: emit close markers for `toClose` set, in reverse-open order.
  function emitClose(toClose: Set<WaMark["type"]>): string {
    // Close in reverse order of opening (innermost first).
    const toCloseOrdered = [...openStack].reverse().filter((m) => toClose.has(m));
    return toCloseOrdered.map((m) => MARK_SERIALIZE[m]).join("");
  }

  // Helper: emit open markers for `toOpen` set, in canonical order.
  function emitOpen(toOpen: Set<WaMark["type"]>): string {
    const toOpenOrdered = [...toOpen].sort((a, b) => markOrder(a) - markOrder(b));
    return toOpenOrdered.map((m) => MARK_SERIALIZE[m]).join("");
  }

  // Peek-ahead: we need to know, at each text-node boundary, what the next
  // node's mark set is. Build a parallel array for text nodes only.
  // We also need to close ALL open marks at the end.

  for (let i = 0; i < content.length; i++) {
    const node = content[i] as WaInline;

    if (node.type === "hardBreak") {
      // Before emitting hardBreak, close all open marks, then reopen them
      // after. (WhatsApp marks don't span across hard breaks in practice, but
      // this keeps serialization safe. In reality TipTap won't create marks
      // across hardBreaks either.)
      if (openStack.length > 0) {
        const closeAll = new Set<WaMark["type"]>(openStack);
        parts.push(emitClose(closeAll));
        openStack = [];
      }
      parts.push("\n");
      continue;
    }

    if (node.type !== "text") {
      parts.push("");
      continue;
    }

    const tn = node as WaText;
    const currSet = markSet(tn);
    const prevSet = new Set<WaMark["type"]>(openStack);

    // Marks to close: in prevSet but not in currSet
    const toClose = new Set<WaMark["type"]>([...prevSet].filter((m) => !currSet.has(m)));
    // Marks to open: in currSet but not in prevSet
    const toOpen = new Set<WaMark["type"]>([...currSet].filter((m) => !prevSet.has(m)));

    // When closing some marks but not all: we need to close all marks that
    // are "inside" any mark being closed (because nesting must be proper).
    // Determine if any mark being closed has marks "inside" it in the stack.
    if (toClose.size > 0) {
      // Find the outermost mark being closed (lowest index in openStack).
      const closeFromIdx = openStack.findIndex((m) => toClose.has(m));
      if (closeFromIdx !== -1) {
        // All marks from closeFromIdx onwards need to be closed (proper nesting).
        const mustClose = new Set<WaMark["type"]>(openStack.slice(closeFromIdx));
        // Marks that were "inside" the closed ones but NOT in toClose need to reopen.
        const mustReopen = new Set<WaMark["type"]>([...mustClose].filter((m) => !toClose.has(m)));

        parts.push(emitClose(mustClose));
        openStack = openStack.slice(0, closeFromIdx);

        // Reopen marks that were forcibly closed
        if (mustReopen.size > 0) {
          parts.push(emitOpen(mustReopen));
          // Add back to openStack in canonical order
          const reopenOrdered = [...mustReopen].sort((a, b) => markOrder(a) - markOrder(b));
          openStack = [...openStack, ...reopenOrdered];
        }
      }
    }

    // Now open new marks
    if (toOpen.size > 0) {
      parts.push(emitOpen(toOpen));
      const openOrdered = [...toOpen].sort((a, b) => markOrder(a) - markOrder(b));
      openStack = [...openStack, ...openOrdered];
    }

    parts.push(tn.text);
  }

  // Close any remaining open marks at end of content
  if (openStack.length > 0) {
    const closeAll = new Set<WaMark["type"]>(openStack);
    parts.push(emitClose(closeAll));
    openStack = [];
  }

  return parts.join("");
}
