import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

// Delete a folder. Its files are NOT deleted — the folderId FK is ON DELETE SET
// NULL, so they simply move back to "All files".
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const folder = await db.mediaFolder.findUnique({ where: { id } });
    if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
    await db.mediaFolder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
