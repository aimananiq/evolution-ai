import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
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
    if (!base) return NextResponse.json({ state: instance.connectionState });
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    let state = instance.connectionState;
    try {
      const fresh = await api.connectionState(instance.evolutionInstanceName);
      state = fresh;
      if (fresh !== instance.connectionState) {
        await db.instance.update({
          where: { id },
          data: { connectionState: fresh, lastSeenAt: fresh === "open" ? new Date() : instance.lastSeenAt },
        });
      }
      // Self-heal the phone number once connected (needed for internal-mode warming).
      if (fresh === "open" && !instance.phoneNumber) {
        const number = await api.ownerNumber(instance.evolutionInstanceName).catch(() => null);
        if (number) await db.instance.update({ where: { id }, data: { phoneNumber: number } });
      }
    } catch {
      // fall back to cached state
    }
    return NextResponse.json({ state });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
