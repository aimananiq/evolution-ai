import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ users });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
