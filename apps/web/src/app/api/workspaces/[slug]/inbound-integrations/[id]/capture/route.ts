import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { collectPaths } from "@evo/inbound-templating";

const schema = z.object({ arm: z.boolean() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const row = await db.inboundIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Integration not found");
    const sample = (row.lastSamplePayload as unknown) ?? null;
    return NextResponse.json({
      captureArmed: row.captureArmed,
      lastReceivedAt: row.lastReceivedAt,
      sample,
      paths: sample ? collectPaths(sample) : [],
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    await db.inboundIntegration.update({ where: { id }, data: { captureArmed: parsed.data.arm } });
    return NextResponse.json({ captureArmed: parsed.data.arm, lastReceivedAt: existing.lastReceivedAt });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
