import Anthropic from "@anthropic-ai/sdk";
import { assertPublicUrl, ssrfAllowHosts } from "@evo/shared/ssrf";

// All providers except Claude speak the OpenAI-compatible /chat/completions API,
// so one client covers Gemini, Grok (xAI), OpenAI, and Ollama Cloud. Claude uses
// the native Anthropic SDK.
export type AiProvider = "claude" | "openai" | "gemini" | "grok" | "ollama";

const OPENAI_COMPAT_BASE: Partial<Record<AiProvider, string>> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  grok: "https://api.x.ai/v1",
};

// Reasoning models (gpt-oss, deepseek-r…) hide their answer behind a thinking
// pass; keep it minimal so the answer isn't starved of tokens.
const REASONING = /gpt-?oss|deepseek-r|qwq|:think|reason/i;

export interface AiChatInput {
  provider: AiProvider;
  apiKey: string | null;
  endpoint?: string | null; // Ollama / self-hosted base URL
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  timeoutMs?: number;
}

/** Provider-agnostic chat completion. Returns the assistant's text. */
export async function aiChat(input: AiChatInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 60_000;

  if (input.provider === "claude") {
    if (!input.apiKey) throw new Error("claude: no API key");
    const client = new Anthropic({ apiKey: input.apiKey });
    const result = await client.messages.create({
      model: input.model,
      system: input.system,
      max_tokens: input.maxTokens ?? 1024,
      messages: input.messages,
    });
    const block = (result.content as any[]).find((b) => b.type === "text");
    return block?.text ?? "";
  }

  const base =
    input.provider === "ollama"
      ? `${(input.endpoint || "https://ollama.com").replace(/\/$/, "")}/v1`
      : OPENAI_COMPAT_BASE[input.provider];
  if (!base) throw new Error(`unsupported provider ${input.provider}`);

  // SSRF guard for the only provider with a user-supplied endpoint. Re-checked at
  // call time (not just at store time) to defend against DNS rebinding.
  if (input.provider === "ollama") {
    const safe = await assertPublicUrl(`${base}/chat/completions`, ssrfAllowHosts());
    if (!safe.ok) throw new Error(`ollama endpoint blocked: ${safe.reason}`);
  }

  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? 1024,
    messages: [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      ...input.messages,
    ],
  };
  if (input.provider === "ollama" && REASONING.test(input.model)) body.reasoning_effort = "low";

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${input.provider} ${res.status}: ${raw.slice(0, 180)}`);
    const json = JSON.parse(raw) as { choices?: { message?: { content?: string } }[] };
    return json?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(to);
  }
}

/** Sensible default model per provider when none is configured. */
export function defaultModelFor(provider: AiProvider): string {
  switch (provider) {
    case "claude": return "claude-haiku-4-5-20251001";
    case "gemini": return "gemini-2.5-flash";
    case "grok": return "grok-3-mini";
    case "openai": return "gpt-4o-mini";
    case "ollama": return "gpt-oss:20b";
    default: return "";
  }
}
