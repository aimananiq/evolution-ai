import { prisma } from "@evo/db";
import { decrypt } from "./encrypt";

export type AiProviderName = "claude" | "openai" | "ollama" | "gemini" | "grok";

export type AiConfig = {
  provider: AiProviderName;
  apiKey: string | null;
  endpoint: string | null;
  model: string | null;
};

// Scoped lookup with fallback to the "default" scope.
async function findAiRow(workspaceId: string, scope = "default") {
  const find = (s: string) => prisma.workspaceAiKey.findUnique({ where: { workspaceId_scope: { workspaceId, scope: s } } });
  return (await find(scope)) ?? (scope !== "default" ? await find("default") : null);
}

/** Back-compat: return just the decrypted key for a provider, or the env fallback. */
export async function resolveAiKey(workspaceId: string, provider: "claude" | "openai", scope = "default"): Promise<string | null> {
  const row = await findAiRow(workspaceId, scope);
  if (row && row.provider === provider) {
    try {
      return await decrypt(row.encryptedKey);
    } catch {
      return null;
    }
  }
  if (provider === "claude") return process.env.ANTHROPIC_API_KEY ?? null;
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? null;
  return null;
}

/**
 * Resolve the full per-workspace AI config (provider + key + endpoint + model).
 * Returns null when the workspace has no AI credentials configured.
 */
export async function resolveAiConfig(workspaceId: string, scope = "default"): Promise<AiConfig | null> {
  const row = await findAiRow(workspaceId, scope);
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
