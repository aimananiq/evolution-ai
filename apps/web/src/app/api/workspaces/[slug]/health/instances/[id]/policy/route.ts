import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const schema = z.object({
  rampEnabled: z.boolean(),
  rampBaseDaily: z.number().int().min(1).max(100000),
  rampGrowthPct: z.number().int().min(0).max(100),
  rampMaxDaily: z.number().int().min(1).max(1000000),
  autoProtect: z.boolean(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.instanceHealthPolicy.findUnique({ where: { instanceId: id } });
    // Start the ramp clock the first time it is enabled.
    const rampStartedAt =
      parsed.data.rampEnabled && !existing?.rampStartedAt ? new Date() : existing?.rampStartedAt ?? null;
    const policy = await db.instanceHealthPolicy.upsert({
      where: { instanceId: id },
      create: { instanceId: id, ...parsed.data, rampStartedAt } as any,
      update: { ...parsed.data, rampStartedAt } as any,
    });
    return NextResponse.json({ policy });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
