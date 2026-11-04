import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, IntegrationApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { encrypt, decrypt, revealSecret } from "@evo/crypto";

const schema = z.object({
  instanceId: z.string(),
  enabled: z.boolean(),
  accountId: z.string().min(1),
  token: z.string().min(1).optional(),
  url: z.string().url(),
  nameInbox: z.string().optional(),
  signMsg: z.boolean().optional(),
  reopenConversation: z.boolean().optional(),
  conversationPending: z.boolean().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const row = await db.workspaceIntegration.findUnique({
      where: { workspaceId_instanceId_kind: { workspaceId: workspace.id, instanceId, kind: "chatwoot" } } as any,
    });
    if (!row) {
      return NextResponse.json({ config: null, enabled: false });
    }
    const rawConfig = row.config as Record<string, unknown> | null;
    const hasToken = Boolean(rawConfig?.token);
    const { token: _omit, ...configWithoutToken } = rawConfig ?? {};
    const maskedConfig = { ...configWithoutToken, hasToken };
    return NextResponse.json({ config: maskedConfig, enabled: row.enabled });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });

    let plaintextToken: string;
    let encryptedToken: string;

    if (parsed.data.token) {
      // New token provided — encrypt it and use it
      plaintextToken = parsed.data.token;
      encryptedToken = await encrypt(plaintextToken);
    } else {
      // No new token — look up existing row and decrypt the stored one
      const existingRow = await db.workspaceIntegration.findUnique({
        where: { workspaceId_instanceId_kind: { workspaceId: workspace.id, instanceId: parsed.data.instanceId, kind: "chatwoot" } } as any,
      });
      if (!existingRow) {
        return NextResponse.json({ error: "TOKEN_REQUIRED_ON_FIRST_SAVE" }, { status: 400 });
      }
      const storedConfig = existingRow.config as Record<string, unknown>;
      const storedEncryptedToken = storedConfig?.token as string | undefined;
      if (!storedEncryptedToken) {
        return NextResponse.json({ error: "TOKEN_REQUIRED_ON_FIRST_SAVE" }, { status: 400 });
      }
      try {
        plaintextToken = await decrypt(storedEncryptedToken);
        encryptedToken = storedEncryptedToken; // keep the existing encrypted blob unchanged
      } catch {
        return NextResponse.json({ error: "STORED_TOKEN_UNREADABLE" }, { status: 500 });
      }
    }

    // Send plaintext token to Evolution
    const api = new IntegrationApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    await api.chatwootSet(instance.evolutionInstanceName, { ...parsed.data, token: plaintextToken });

    // Persist with encrypted token
    const configToStore = { ...parsed.data, token: encryptedToken };

    await db.workspaceIntegration.upsert({
      where: { workspaceId_instanceId_kind: { workspaceId: workspace.id, instanceId: parsed.data.instanceId, kind: "chatwoot" } } as any,
      create: {
        instanceId: parsed.data.instanceId,
        kind: "chatwoot",
        config: configToStore as any,
        enabled: parsed.data.enabled,
      } as any,
      update: { config: configToStore as any, enabled: parsed.data.enabled },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
