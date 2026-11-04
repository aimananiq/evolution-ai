import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const broadcast = await db.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundError("Broadcast not found");
    if (broadcast.status !== "paused") return NextResponse.json({ error: "NOT_PAUSED" }, { status: 400 });
    await db.broadcast.update({ where: { id }, data: { status: "running", nextSlotAt: null } });
    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "broadcast.resumed",
      target: `broadcast:${id}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
