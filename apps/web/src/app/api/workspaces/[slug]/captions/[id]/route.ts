import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { isUniqueViolation } from "@/lib/prisma-errors";

const updateSchema = z.object({ name: z.string().min(1).max(80).optional(), body: z.string().min(1).max(2000).optional() });

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.caption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Caption not found");
    const item = await db.caption.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (isUniqueViolation(e)) return NextResponse.json({ error: "DUPLICATE" }, { status: 409 });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.caption.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Caption not found");
    await db.caption.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
