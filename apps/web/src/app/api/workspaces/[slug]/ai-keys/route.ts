import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { encrypt } from "@/lib/encrypt";
import { AppError } from "@evo/shared";
import { assertPublicUrl, ssrfAllowHosts } from "@evo/shared/ssrf";

const SCOPES = ["default", "warmer", "chatbot"] as const;

const schema = z
  .object({
    scope: z.enum(SCOPES).default("default"),
    provider: z.enum(["claude", "openai", "ollama", "gemini", "grok"]),
    apiKey: z.string().max(500).optional().default(""),
    endpoint: z.string().url().max(200).optional().or(z.literal("")),
    defaultModel: z.string().max(120).optional(),
  })
  // Claude / OpenAI require a key; Ollama can be keyless (local) or keyed (cloud).
  .refine((d) => d.provider === "ollama" || (d.apiKey?.length ?? 0) >= 10, {
    path: ["apiKey"],
    message: "API key required",
  });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const rows = await prisma.workspaceAiKey.findMany({ where: { workspaceId: workspace.id } });
    const keys: Record<string, { provider: string; defaultModel: string | null; endpoint: string | null; hasKey: boolean } | null> = {};
    for (const s of SCOPES) {
      const row = rows.find((r) => r.scope === s);
      keys[s] = row ? { provider: row.provider, defaultModel: row.defaultModel, endpoint: row.endpoint, hasKey: !!row.encryptedKey } : null;
    }
    // `key` kept for back-compat (the default scope).
    return NextResponse.json({ keys, key: keys.default });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const { scope, provider, apiKey, endpoint, defaultModel } = parsed.data;

    // SSRF guard: the endpoint is fetched server-side (model list + chat), so reject
    // anything resolving to an internal address. Operators can opt-in specific hosts
    // (e.g. a self-hosted Ollama on the LAN) via SSRF_ALLOW_HOSTS.
    if (endpoint) {
      const safe = await assertPublicUrl(endpoint, ssrfAllowHosts());
      if (!safe.ok) {
        return NextResponse.json({ error: "ENDPOINT_NOT_ALLOWED", detail: safe.reason }, { status: 400 });
      }
    }

    const existing = await prisma.workspaceAiKey.findUnique({ where: { workspaceId_scope: { workspaceId: workspace.id, scope } } });

    // Keep the stored key when the field is left blank on an update (e.g. changing
    // only the model or endpoint). Empty is allowed to persist for keyless Ollama.
    let encryptedKey: string;
    if (apiKey && apiKey.length) encryptedKey = await encrypt(apiKey);
    else if (existing) encryptedKey = existing.encryptedKey;
    else encryptedKey = await encrypt("");

    const data = { provider, encryptedKey, endpoint: endpoint || null, defaultModel: defaultModel || null };
    await prisma.workspaceAiKey.upsert({
      where: { workspaceId_scope: { workspaceId: workspace.id, scope } },
      create: { workspaceId: workspace.id, scope, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const scope = new URL(req.url).searchParams.get("scope") ?? "default";
    await prisma.workspaceAiKey.deleteMany({ where: { workspaceId: workspace.id, scope } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
