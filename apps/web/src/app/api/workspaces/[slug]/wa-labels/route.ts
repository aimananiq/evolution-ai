import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, LabelsApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError } from "@evo/shared";

// Lists the WhatsApp-native chat labels for an instance, read live from Evolution.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: instanceId } });
    if (!instance) return NextResponse.json({ error: "instance not found" }, { status: 404 });
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new LabelsApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    try {
      const labels = await api.findLabels(instance.evolutionInstanceName);
      return NextResponse.json({ labels });
    } catch {
      return NextResponse.json({ labels: [], error: "FETCH_FAILED" }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
