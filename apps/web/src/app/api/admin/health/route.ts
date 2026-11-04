import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const [workspaceCount, userCount, instanceCount, recentMessages, runningWarmers, runningBroadcasts] = await Promise.all([
      prisma.workspace.count(),
      prisma.user.count(),
      prisma.instance.count(),
      prisma.message.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      prisma.warmerRun.count({ where: { status: "running" } }),
      prisma.broadcast.count({ where: { status: "running" } }),
    ]);
    return NextResponse.json({
      workspaceCount, userCount, instanceCount, recentMessages,
      runningWarmers, runningBroadcasts,
      now: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
