import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

const schema = z.object({
  id: z.string().optional(),
  kind: z.enum(["free", "pro", "enterprise", "custom"]),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  contactCap: z.number().int().min(0),
  instanceCap: z.number().int().min(0),
  monthlyMessageCap: z.number().int().min(0),
  featureFlags: z.record(z.any()),
});

export async function GET() {
  try {
    await requireSuperAdmin();
    const plans = await prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ plans });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const plan = await prisma.plan.upsert({
      where: { kind: parsed.data.kind },
      create: parsed.data as any,
      update: { ...parsed.data, featureFlags: parsed.data.featureFlags as any },
    });
    return NextResponse.json({ plan });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
