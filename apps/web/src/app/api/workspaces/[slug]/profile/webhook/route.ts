import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, WebhookApi, WebhookEventSchema } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

const putSchema = z.object({
  instanceId: z.string(),
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().url(),
    byEvents: z.boolean().optional().default(false),
    base64: z.boolean().optional().default(true),
    events: z.array(WebhookEventSchema).default([]),
  }),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instanceId = new URL(req.url).searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });

    const api = new WebhookApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    try {
      const webhook = await api.find(instance.evolutionInstanceName);
      return NextResponse.json({ webhook });
    } catch {
      return NextResponse.json({ webhook: null, error: "FETCH_FAILED" }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const { instanceId, webhook } = parsed.data;

    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });

    const api = new WebhookApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    try {
      await api.set(instance.evolutionInstanceName, { webhook });
    } catch {
      return NextResponse.json({ error: "EVOLUTION_ERROR" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
