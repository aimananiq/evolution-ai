import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi, EvolutionNotFoundError } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    try {
      const qr = await api.connect(instance.evolutionInstanceName);
      return NextResponse.json({ qr });
    } catch (e) {
      if (e instanceof EvolutionNotFoundError) {
        return NextResponse.json({ error: "EVOLUTION_INSTANCE_GONE" }, { status: 410 });
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
