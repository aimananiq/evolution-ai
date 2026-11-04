import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const workspaces = await prisma.workspace.findMany({
      include: {
        _count: { select: { members: true, instances: true, contacts: true } },
        plan: { include: { plan: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ workspaces });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
