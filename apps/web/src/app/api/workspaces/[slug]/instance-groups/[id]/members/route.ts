import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({ instanceIds: z.array(z.string()).min(1).max(100) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundError("Group not found");
    const owned = await db.instance.findMany({ where: { id: { in: parsed.data.instanceIds } }, select: { id: true } });
    if (owned.length !== parsed.data.instanceIds.length) {
      return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 400 });
    }
    await db.instanceGroupMember.createMany({
      data: owned.map((i) => ({ groupId: id, instanceId: i.id })),
      skipDuplicates: true,
    } as any);
    return NextResponse.json({ ok: true, added: owned.length });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundError("Group not found");
    await db.instanceGroupMember.deleteMany({
      where: { groupId: id, instanceId: { in: parsed.data.instanceIds } },
    } as any);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
