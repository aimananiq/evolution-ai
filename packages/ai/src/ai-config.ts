import { prisma } from "@evo/db";
import { decrypt } from "@evo/crypto";
import type { WarmerAiCredentials } from "./warmer";

export type AiProviderName = "claude" | "openai" | "ollama" | "gemini" | "grok";

export interface WorkspaceAiConfig {
  provider: AiProviderName;
  apiKey: string | null;
  endpoint: string | null;
  model: string | null;
}

/**
 * Full per-workspace AI config for a scope ("default" | "warmer" | "chatbot").
 * A scope-specific config wins; otherwise it falls back to the "default" scope.
 */
export async function resolveAiConfig(workspaceId: string, scope: string = "default"): Promise<WorkspaceAiConfig | null> {
  const find = (s: string) => prisma.workspaceAiKey.findUnique({ where: { workspaceId_scope: { workspaceId, scope: s } } });
  let row = await find(scope);
  if (!row && scope !== "default") row = await find("default");
  if (!row) return null;
  let apiKey: string | null = null;
  try {
    apiKey = row.encryptedKey ? await decrypt(row.encryptedKey) : null;
  } catch {
    apiKey = null;
  }
  return {
    provider: row.provider as AiProviderName,
    apiKey: apiKey || null,
    endpoint: row.endpoint ?? null,
    model: row.defaultModel ?? null,
  };
}

/**
 * Map a workspace AI config to warmer credentials. Returns null when the workspace
 * cannot generate (unconfigured, or a provider the warmer doesn't support here).
 */
export function toWarmerCredentials(cfg: WorkspaceAiConfig | null): WarmerAiCredentials | null {
  if (!cfg) return null;
  if (cfg.provider === "ollama") {
    return { provider: "ollama", apiKey: cfg.apiKey, endpoint: cfg.endpoint, model: cfg.model };
  }
  // Hosted providers need a key.
  if (!cfg.apiKey) return null;
  if (cfg.provider === "claude") {
    return { provider: "anthropic", apiKey: cfg.apiKey, endpoint: null, model: cfg.model };
  }
  // gemini / grok / openai via the OpenAI-compatible layer.
  return { provider: cfg.provider, apiKey: cfg.apiKey, endpoint: null, model: cfg.model };
}
