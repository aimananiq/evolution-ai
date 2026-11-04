import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const stepSchema = z.object({
  templateId: z.string(),
  delayMs: z.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  steps: z.array(stepSchema).min(1).max(50).optional(),
  active: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const campaign = await db.dripCampaign.findUnique({
      where: { id },
      include: {
        _count: { select: { enrolments: true } },
        instance: { select: { label: true } },
      },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");
    return NextResponse.json({ campaign });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.dripCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Campaign not found");
    const campaign = await db.dripCampaign.update({
      where: { id },
      data: { ...parsed.data, steps: parsed.data.steps as any },
    });
    return NextResponse.json({ campaign });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.dripCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Campaign not found");
    await db.dripCampaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
