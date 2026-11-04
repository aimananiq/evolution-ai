import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const integ = await db.inboundIntegration.findUnique({ where: { id }, select: { id: true } });
    if (!integ) throw new NotFoundError("Integration not found");
    const logs = await db.inboundIntegrationLog.findMany({
      where: { integrationId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, resolvedPhone: true, status: true, error: true, createdAt: true },
    });
    return NextResponse.json({ logs });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
