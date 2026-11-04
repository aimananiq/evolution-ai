import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string; targetId: string }> },
) {
  const { slug, id, targetId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);

    const broadcast = await db.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundError("Broadcast not found");

    await db.broadcastTarget.updateMany({
      where: { id: targetId, broadcastId: id },
      data: { status: "queued", error: null, instanceId: null },
    });

    await db.broadcast.update({
      where: { id },
      data: { status: "running", completedAt: null },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
