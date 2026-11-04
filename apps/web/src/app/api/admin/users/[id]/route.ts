import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError, NotFoundError, ForbiddenError } from "@evo/shared";

const patchSchema = z.object({ isSuperAdmin: z.boolean() });

// Grant/revoke super-admin. Guards against removing your own access (lockout).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { userId } = await requireSuperAdmin();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError("User not found");
    if (id === userId && parsed.data.isSuperAdmin === false) {
      throw new ForbiddenError("You cannot remove your own super-admin access");
    }
    await prisma.user.update({ where: { id }, data: { isSuperAdmin: parsed.data.isSuperAdmin } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

// Delete a user (and their memberships/sessions). Cannot delete yourself.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { userId } = await requireSuperAdmin();
    if (id === userId) throw new ForbiddenError("You cannot delete your own account");
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError("User not found");
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
