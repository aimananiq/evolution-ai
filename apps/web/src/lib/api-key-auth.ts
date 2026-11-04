import { headers } from "next/headers";
import argon2 from "argon2";
import { prisma } from "@evo/db";

/**
 * Verifies an `Authorization: Bearer ek_…` workspace API key against the
 * argon2id hashes stored for the workspace. Returns the key row id on success.
 * Keys act with Admin-level permissions (never Owner).
 */
export async function verifyApiKey(workspaceId: string): Promise<string | null> {
  const h = await headers();
  const authz = h.get("authorization") ?? "";
  const match = authz.match(/^Bearer\s+(ek_[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const token = match[1]!;

  const keys = await prisma.apiKey.findMany({
    where: { workspaceId, revokedAt: null },
    select: { id: true, hashedKey: true },
    take: 50,
  });
  for (const key of keys) {
    try {
      if (await argon2.verify(key.hashedKey, token)) {
        // best-effort usage tracking
        prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
        return key.id;
      }
    } catch {
      /* malformed hash — skip */
    }
  }
  return null;
}
