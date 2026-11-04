export interface Chunk {
  title: string;
  content: string;
}

export interface ChunkOptions {
  baseTitle?: string;
  maxChars?: number;
  maxChunks?: number;
}

export interface ChunkResult {
  chunks: Chunk[];
  truncated: boolean;
}

const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

function clampTitle(t: string): string {
  const s = t.trim().replace(/\s+/g, " ");
  return s.length <= 120 ? s : s.slice(0, 120).trimEnd();
}

/** Pack blank-line-separated paragraphs into content blocks up to maxChars. */
function packParagraphs(text: string, maxChars: number): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (!cur) {
      cur = p;
    } else if (cur.length + 2 + p.length <= maxChars) {
      cur = `${cur}\n\n${p}`;
    } else {
      out.push(cur);
      cur = p;
    }
    // A single paragraph longer than maxChars is emitted whole (we don't split mid-sentence).
    while (cur.length > maxChars && out.length >= 0) {
      // Hard-split only very long single paragraphs on whitespace near the limit.
      const slice = cur.slice(0, maxChars);
      const cut = slice.lastIndexOf(" ");
      const at = cut > maxChars * 0.5 ? cut : maxChars;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at).trim();
    }
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

export function chunkDocument(text: string, opts: ChunkOptions = {}): ChunkResult {
  const baseTitle = clampTitle(opts.baseTitle || "Untitled");
  const maxChars = opts.maxChars ?? 800;
  const maxChunks = opts.maxChunks ?? 200;

  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections: { title: string | null; body: string }[] = [];
  let curTitle: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    const body = curBody.join("\n").trim();
    if (body || curTitle) sections.push({ title: curTitle, body });
    curBody = [];
  };

  let sawHeading = false;
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      sawHeading = true;
      flush();
      curTitle = clampTitle(m[1]!);
      curBody = [];
    } else {
      curBody.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];
  let paraIndex = 0;

  for (const sec of sections) {
    if (!sec.body.trim()) continue;
    const parts = packParagraphs(sec.body, maxChars);
    parts.forEach((part, i) => {
      let title: string;
      if (sec.title) {
        title = parts.length > 1 ? `${sec.title} (${i + 1})` : sec.title;
      } else {
        // Untitled section (no heading, or preamble before the first heading).
        paraIndex += 1;
        title = sawHeading || parts.length > 1 || paraIndex > 1 ? `${baseTitle} (${paraIndex})` : baseTitle;
      }
      chunks.push({ title: clampTitle(title), content: part.trim() });
    });
  }

  const truncated = chunks.length > maxChunks;
  return { chunks: truncated ? chunks.slice(0, maxChunks) : chunks, truncated };
}

/** Split text into chunks of ~maxChars, breaking on paragraph then sentence bounds. */
export function chunkText(input: string, maxChars = 800): string[] {
  const text = (input ?? "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let buf = "";
  const units = text.split(/\n\s*\n/).flatMap((p) => p.match(/[^.!?]+[.!?]?\s*/g) ?? [p]);
  for (const u of units) {
    if (buf.length + u.length > maxChars && buf) {
      parts.push(buf.trim());
      buf = "";
    }
    buf += u;
    while (buf.length > maxChars) {
      parts.push(buf.slice(0, maxChars).trim());
      buf = buf.slice(maxChars);
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

export type MeterTier = "green" | "amber" | "red";
/** Topic knowledge size guidance. */
export function meterTier(totalTokens: number): MeterTier {
  if (totalTokens < 30_000) return "green";
  if (totalTokens < 120_000) return "amber";
  return "red";
}
