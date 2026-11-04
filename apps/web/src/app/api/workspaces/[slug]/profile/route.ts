import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, ProfileApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

const putSchema = z.object({
  instanceId: z.string(),
  name: z.string().max(100).optional(),
  status: z.string().max(500).optional(),
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
    return NextResponse.json({
      instanceId: instance.evolutionInstanceName,
      accessToken: await revealSecret(instance.evolutionApiKey),
      phoneNumber: instance.phoneNumber,
      profileName: instance.profileName ?? instance.label,
      profilePictureUrl: instance.profilePictureUrl,
      evolutionPort: process.env.EVOLUTION_PORT ?? null,
    });
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
    const { instanceId, name, status } = parsed.data;

    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });

    const api = new ProfileApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    try {
      if (name !== undefined) await api.updateProfileName(instance.evolutionInstanceName, name);
      if (status !== undefined) await api.updateProfileStatus(instance.evolutionInstanceName, status);
    } catch {
      return NextResponse.json({ error: "EVOLUTION_ERROR" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
