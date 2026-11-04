import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const stepSchema = z.object({
  templateId: z.string(),
  delayMs: z.number().int().min(0).max(60 * 24 * 60 * 60 * 1000),
});

const schema = z.object({
  name: z.string().min(1).max(120),
  instanceId: z.string(),
  triggerType: z.enum(["manual", "newContact"]).default("manual"),
  steps: z.array(stepSchema).min(1).max(50),
  active: z.boolean().optional().default(true),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const campaigns = await db.dripCampaign.findMany({
      include: { _count: { select: { enrolments: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ campaigns });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const campaign = await db.dripCampaign.create({
      data: {
        instanceId: parsed.data.instanceId,
        name: parsed.data.name,
        triggerType: parsed.data.triggerType,
        steps: parsed.data.steps as any,
        active: parsed.data.active,
      } as any,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
