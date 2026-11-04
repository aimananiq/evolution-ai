import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, ContactApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  instanceId: z.string(),
  numbers: z.array(z.string().min(8)).min(1).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new ContactApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
    const checks = await api.checkNumbers(instance.evolutionInstanceName, parsed.data.numbers);
    return NextResponse.json({ checks });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
