import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Key not found");
    await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit({ workspaceId: workspace.id, userId, action: "apikey.revoked", target: `apikey:${id}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
