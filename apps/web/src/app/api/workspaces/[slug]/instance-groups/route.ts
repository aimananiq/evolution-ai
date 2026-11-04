import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { isUniqueViolation } from "@/lib/prisma-errors";

const schema = z.object({ name: z.string().min(1).max(120) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const groups = await db.instanceGroup.findMany({
      include: { members: { select: { instanceId: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ groups });
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
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.create({ data: parsed.data as any });
    return NextResponse.json({ group }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (isUniqueViolation(e)) return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    throw e;
  }
}
