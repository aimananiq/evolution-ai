/**
 * Pure logic for the inbox "Suggest reply" agent-assist feature.
 * Kept free of I/O so it can be unit-tested; the API route wires it to Prisma + @evo/ai.
 */

/** Matches the app's documented default; overridden by any configured model. */
export const DEFAULT_SUGGEST_MODEL = "claude-haiku-4-5";

const DEFAULT_SYSTEM_PROMPT =
  "You are a customer-support agent drafting a reply on WhatsApp for the business. " +
  "Write a single, ready-to-send reply in the customer's language. Be concise, friendly, " +
  "and professional.";

/** Appended to every system prompt so the model returns only the message text. */
const REPLY_ONLY_SUFFIX =
  "\n\nOutput only the message text to send — no preamble, quotes, labels, or explanations.";

export interface SuggestInputMessage {
  direction: "inbound" | "outbound";
  body: string | null;
}

export interface ChatbotConfig {
  systemPrompt: string | null;
  fallbackModel: string | null;
}

export interface SuggestRequest {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Builds the claudeReply request from conversation history and configuration.
 * Returns null when there is no usable message context (caller returns 422).
 */
export function buildSuggestRequest(
  recentChronological: SuggestInputMessage[],
  chatbot: ChatbotConfig | null,
  workspaceDefaultModel: string | null,
  knowledgeBlock?: string | null,
): SuggestRequest | null {
  const messages = recentChronological
    .filter((m) => (m.body ?? "").trim().length > 0)
    .map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.body!.trim(),
    }));

  if (messages.length === 0) return null;

  // A conversation Claude can reply to must start on a user turn.
  while (messages.length > 0 && messages[0]!.role === "assistant") {
    messages.shift();
  }
  if (messages.length === 0) return null;

  const model =
    chatbot?.fallbackModel?.trim() ||
    workspaceDefaultModel?.trim() ||
    DEFAULT_SUGGEST_MODEL;

  const base = chatbot?.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const grounding = knowledgeBlock?.trim() ? `\n\n${knowledgeBlock.trim()}` : "";
  const systemPrompt = base + grounding + REPLY_ONLY_SUFFIX;

  return { model, systemPrompt, messages };
}
