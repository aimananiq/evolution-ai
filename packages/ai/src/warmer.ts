// Provider-aware warmer conversation generation (Ollama local/cloud + Anthropic).
// Generates a full, natural, optionally campaign-themed conversation as an array
// of alternating message strings. Any failure throws so the caller can fall back
// to static templates.

import { aiChat, defaultModelFor, type AiProvider } from "./providers";

export type WarmerAiProvider = "ollama" | "anthropic" | "claude" | "gemini" | "grok" | "openai";

export interface WarmerAiCredentials {
  provider: WarmerAiProvider;
  apiKey: string | null;
  endpoint: string | null; // Ollama base URL; ignored for hosted providers
  model: string | null;
}

export interface WarmerCampaign {
  enabled?: boolean;
  intensity?: "subtle" | "moderate" | "direct";
  topics?: string[];
  sampleMessages?: string[];
}

export interface GenerateWarmerConversationInput {
  credentials: WarmerAiCredentials;
  names: [string, string];
  turns: number;
  style?: string;
  campaign?: WarmerCampaign;
  maxTokens?: number;
  timeoutMs?: number;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OLLAMA_DEFAULT_URL = "https://ollama.com";

function campaignSubject(campaign?: WarmerCampaign): string | null {
  if (!campaign?.enabled) return null;
  const topics = (campaign.topics ?? []).filter(Boolean);
  const samples = (campaign.sampleMessages ?? []).filter(Boolean);
  if (!topics.length && !samples.length) return null;
  const intensityLine =
    {
      subtle: "Keep it light — the subject only comes up in passing, the way it naturally might.",
      moderate: "The friends clearly end up discussing this subject — sharing thoughts and asking each other about it.",
      direct: "One friend actively brings it up and shares or recommends it, like a genuine tip between friends.",
    }[(campaign.intensity ?? "subtle").toLowerCase()] ?? "Keep it natural.";
  const parts: string[] = [];
  if (topics.length) parts.push(`Subject / topics: ${topics.join("; ")}.`);
  if (samples.length) {
    const ex = samples.map((s) => `"${String(s).replace(/\s+/g, " ").slice(0, 160)}"`).join(" | ");
    parts.push(`These are drafts of what will be promoted later — use ONLY for the theme, never copy them: ${ex}.`);
  }
  return `The two friends should naturally end up talking about the following subject the way real friends would — one mentions it, the other reacts with curiosity, a question, or their own experience. It is organic small talk that happens to revolve around the subject. It must NOT read like an advertisement or a broadcast.
${parts.join("\n")}
${intensityLine}`;
}

export function buildWarmerPrompt(
  names: [string, string],
  turns: number,
  style?: string,
  campaign?: WarmerCampaign,
): string {
  const [nameA, nameB] = names;
  const subjectBlock =
    campaignSubject(campaign) ?? "About whatever two friends would casually text about.";
  return `Write a realistic WhatsApp conversation between two Malaysian friends, "${nameA}" and "${nameB}".
${subjectBlock}
Style: ${style || "Casual, short, natural, a little imperfect."}
Rules:
- Exactly ${turns} messages, alternating between the two friends.
- Each message is ONE short line (usually 2-12 words). Human and imperfect. Don't greet every time.
- Never sound like a bot; never mention being an AI; never write it like an ad or promo.
- Output ONLY the message texts. Do NOT include the speaker names, no "${nameA}:", no labels, no numbering.
Return ONLY a JSON array of exactly ${turns} message strings. Example format: ["dah makan?","belum lah, u?","jom mamak petang ni"]`;
}

function cleanLine(s: string, nameSet: Set<string>): string {
  let x = String(s)
    .trim()
    .replace(/^\s*[-*]\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/^[\s"'[]+/, "")
    .replace(/["'\],]+\s*$/, "")
    .trim();
  const colon = x.match(/^["']?([\w ]{1,20})["']?\s*:\s*["']?(.+)$/);
  if (colon) return colon[2]!.replace(/["'\s]+$/, "").trim();
  const comma = x.match(/^([\w ]{1,20})["']?\s*,\s*["'](.+)$/);
  if (comma && nameSet.has(comma[1]!.trim().toLowerCase())) return comma[2]!.replace(/["'\s]+$/, "").trim();
  return x;
}

export function parseWarmerLines(text: string, names: string[] = []): string[] | null {
  if (!text) return null;
  const nameSet = new Set(names.map((n) => String(n).toLowerCase()));
  const t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let items: string[] | null = null;
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) items = arr.map(String);
    } catch {
      /* fall through */
    }
  }
  if (items) {
    const evensAreNames =
      items.length >= 4 && items.filter((_, i) => i % 2 === 0).every((x) => nameSet.has(x.trim().toLowerCase()));
    if (evensAreNames) items = items.filter((_, i) => i % 2 === 1);
  } else {
    items = t.split("\n");
  }
  const cleaned = items.map((s) => cleanLine(s, nameSet)).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Reasoning models (gpt-oss, deepseek-r, qwq…) emit a hidden "thinking" channel
// before the answer. With a small num_predict the reasoning consumes the whole
// budget and `message.content` comes back EMPTY. So for those we minimise the
// reasoning (`think: "low"`) and give the answer plenty of room.
const REASONING_MODEL = /gpt-?oss|deepseek-r|qwq|reason|think/i;

async function callOllama(cred: WarmerAiCredentials, prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const base = (cred.endpoint || OLLAMA_DEFAULT_URL).replace(/\/$/, "");
  const model = cred.model || "llama3";
  const reasoning = REASONING_MODEL.test(model);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cred.apiKey) headers["Authorization"] = `Bearer ${cred.apiKey}`;
  return withTimeout(timeoutMs, async (signal) => {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { num_predict: reasoning ? Math.max(maxTokens, 1500) : maxTokens, temperature: 0.9 },
    };
    if (reasoning) body.think = "low";
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers, body: JSON.stringify(body), signal });
    const raw = await res.text();
    if (!res.ok) throw new Error(`ollama ${res.status}: ${raw.slice(0, 180)}`);
    const msg = (JSON.parse(raw)?.message ?? {}) as { content?: string; thinking?: string };
    // Prefer the real answer; if a reasoning model still left content empty, try to
    // salvage a JSON array from its thinking channel rather than failing outright.
    if (msg.content && msg.content.trim()) return msg.content;
    if (msg.thinking) {
      const arr = msg.thinking.match(/\[[\s\S]*\]/);
      if (arr) return arr[0];
    }
    return msg.content ?? "";
  });
}

async function callAnthropic(cred: WarmerAiCredentials, prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  if (!cred.apiKey) throw new Error("anthropic: no API key");
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": cred.apiKey!, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: cred.model || "claude-haiku-4-5",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${raw.slice(0, 180)}`);
    return ((JSON.parse(raw).content as any[]) || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  });
}

export async function generateWarmerConversation(input: GenerateWarmerConversationInput): Promise<string[]> {
  const { credentials, names, turns } = input;
  const maxTokens = input.maxTokens ?? 400;
  const timeoutMs = input.timeoutMs ?? 90000;
  const prompt = buildWarmerPrompt(names, turns, input.style, input.campaign);
  let text: string;
  if (credentials.provider === "ollama") {
    // Keep the proven native path (think:low) for the warmer's Ollama use.
    text = await callOllama(credentials, prompt, maxTokens, timeoutMs);
  } else if (credentials.provider === "anthropic" || credentials.provider === "claude") {
    text = await callAnthropic(credentials, prompt, maxTokens, timeoutMs);
  } else {
    // gemini / grok / openai via the OpenAI-compatible layer.
    text = await aiChat({
      provider: credentials.provider as AiProvider,
      apiKey: credentials.apiKey,
      endpoint: credentials.endpoint,
      model: credentials.model || defaultModelFor(credentials.provider as AiProvider),
      messages: [{ role: "user", content: prompt }],
      maxTokens: Math.max(maxTokens, 800),
      timeoutMs,
    });
  }
  const lines = parseWarmerLines(text, names);
  if (!lines || lines.length < 2) throw new Error("unparseable model output");
  return lines.slice(0, turns);
}
