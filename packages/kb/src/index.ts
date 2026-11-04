export { chunkDocument } from "./chunk";
export type { Chunk, ChunkOptions, ChunkResult } from "./chunk";
export { chunkText, estimateTokens, meterTier, type MeterTier } from "./chunk";
export { buildTopicSystemPrompt, shouldHandoff, DEFAULT_GUARDRAILS, type TopicGuardrails } from "./topic-prompt";

export interface KbSnippet {
  id: string;
  title: string;
  content: string;
}

export interface RetrieveOptions {
  limit?: number;
  maxCharsPerSnippet?: number;
  /**
   * When true, `block` is just the joined snippet lines, WITHOUT the
   * general-knowledge preamble. Used by the topic path where
   * `answerOnlyFromKnowledge` must not be contradicted.
   */
  bare?: boolean;
}

export interface RetrieveResult {
  used: KbSnippet[];
  block: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "you", "your", "our", "with", "what", "how", "can",
  "does", "was", "were", "this", "that", "have", "has", "had", "will", "would",
  "about", "from", "into", "any", "all", "who", "why", "when", "where", "there",
  "here", "not", "but", "out", "get", "got", "its", "his", "her", "them", "they",
]);

const TITLE_WEIGHT = 3;
const CONTENT_WEIGHT = 1;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function clamp(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

export function retrieveContext(
  query: string,
  snippets: KbSnippet[],
  opts: RetrieveOptions = {},
): RetrieveResult {
  const limit = opts.limit ?? 3;
  const maxChars = opts.maxCharsPerSnippet ?? 600;

  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return { used: [], block: "" };

  const scored = snippets
    .map((s) => {
      const titleTokens = new Set(tokenize(s.title));
      const contentTokens = new Set(tokenize(s.content));
      let score = 0;
      for (const q of queryTokens) {
        if (titleTokens.has(q)) score += TITLE_WEIGHT;
        else if (contentTokens.has(q)) score += CONTENT_WEIGHT;
      }
      return { snippet: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return { used: [], block: "" };

  const used = scored.map((x) => x.snippet);
  const lines = used.map((s) => `- ${clamp(s.title, 120)}: ${clamp(s.content, maxChars)}`);
  const joined = lines.join("\n");
  const block = opts.bare
    ? joined
    : "Use the following business information when answering. If it does not cover the " +
      "question, rely on general knowledge and do not invent specifics.\n\n" +
      joined;

  return { used, block };
}
