import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> }
) {
  const { slug, memberId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const member = await db.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (member.role === "Owner") return NextResponse.json({ error: "CANNOT_REMOVE_OWNER" }, { status: 409 });
    await db.workspaceMember.delete({ where: { id: memberId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
