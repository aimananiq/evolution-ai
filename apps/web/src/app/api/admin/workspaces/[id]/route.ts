import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError, NotFoundError } from "@evo/shared";

const patchSchema = z.object({ planKind: z.enum(["free", "pro", "enterprise", "custom"]) });

// Change a workspace's plan.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireSuperAdmin();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const workspace = await prisma.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!workspace) throw new NotFoundError("Workspace not found");
    const plan = await prisma.plan.findUnique({ where: { kind: parsed.data.planKind }, select: { id: true } });
    if (!plan) return NextResponse.json({ error: "PLAN_NOT_FOUND" }, { status: 404 });
    await prisma.workspacePlan.upsert({
      where: { workspaceId: id },
      create: { workspaceId: id, planId: plan.id },
      update: { planId: plan.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

// Delete a workspace (cascades members, instances, contacts, warmers, etc.).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireSuperAdmin();
    const workspace = await prisma.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!workspace) throw new NotFoundError("Workspace not found");
    await prisma.workspace.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
