import Anthropic from "@anthropic-ai/sdk";

export interface ClaudeReplyInput {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  apiKey?: string; // NEW
}

export async function claudeReply(input: ClaudeReplyInput): Promise<string> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: input.model,
    system: input.systemPrompt,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 1024,
  });
  const block = (result.content as any[]).find((b) => b.type === "text");
  return block?.text ?? "";
}

export { aiChat, defaultModelFor } from "./providers";
export type { AiProvider, AiChatInput } from "./providers";
export { buildWarmerPrompt, parseWarmerLines, generateWarmerConversation } from "./warmer";
export type {
  WarmerAiProvider,
  WarmerAiCredentials,
  WarmerCampaign,
  GenerateWarmerConversationInput,
} from "./warmer";
export { resolveAiConfig, toWarmerCredentials } from "./ai-config";
export type { AiProviderName, WorkspaceAiConfig } from "./ai-config";
