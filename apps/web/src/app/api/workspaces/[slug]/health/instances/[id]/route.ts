import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const snapshots = await db.instanceHealthSnapshot.findMany({
      where: { instanceId: id },
      orderBy: { date: "desc" },
      take: 14,
    });
    const alerts = await db.healthAlert.findMany({
      where: { instanceId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ snapshots, alerts });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
