import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { remainingBulkToday } from "@evo/send";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instances = await db.instance.findMany({
      select: { id: true, label: true, phoneNumber: true, connectionState: true },
      orderBy: { label: "asc" },
    });
    const today = new Date();
    const rows = await Promise.all(
      instances.map(async (inst) => {
        const snapshot = await db.instanceHealthSnapshot.findFirst({
          where: { instanceId: inst.id },
          orderBy: { date: "desc" },
        });
        const policy = await db.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
        const remaining = await remainingBulkToday(inst.id, today);
        const openAlerts = await db.healthAlert.count({ where: { instanceId: inst.id, acknowledgedAt: null } });
        return { instance: inst, snapshot, policy, remainingBulkToday: remaining, openAlerts };
      }),
    );
    return NextResponse.json({ instances: rows });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
