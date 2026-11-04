import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const broadcast = await db.broadcast.findUnique({
      where: { id },
      include: {
        list: { select: { name: true } },
        template: { select: { name: true, body: true } },
        instance: { select: { label: true } },
      },
    });
    if (!broadcast) throw new NotFoundError("Broadcast not found");

    const counts = await db.broadcastTarget.groupBy({
      by: ["status"],
      where: { broadcastId: id },
      _count: { _all: true },
    });

    const totals = { queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    for (const c of counts) totals[c.status as keyof typeof totals] = c._count._all;

    return NextResponse.json({ broadcast, totals });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
