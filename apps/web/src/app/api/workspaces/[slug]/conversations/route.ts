import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all";
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const where: any = {};
    if (filter === "mine") where.assignedToUserId = userId;
    if (filter === "unassigned") where.assignedToUserId = null;
    if (filter === "open") where.status = "open";
    const conversations = await db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ conversations });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
