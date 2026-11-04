import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");
    return NextResponse.json({ instance });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (base) {
      const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
      try {
        await api.deleteInstance(instance.evolutionInstanceName);
      } catch {
        // best-effort: even if Evolution is down we delete locally
      }
    }
    await db.instance.delete({ where: { id } });

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "instance.deleted",
      target: `instance:${id}`,
      diff: { label: instance.label, evolutionInstanceName: instance.evolutionInstanceName },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
