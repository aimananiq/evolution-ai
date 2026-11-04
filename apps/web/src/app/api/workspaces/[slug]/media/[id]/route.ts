import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { deleteAsset } from "@/lib/media-storage";
import { writeAudit } from "@/lib/audit";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);

    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError("Asset not found");

    await db.mediaAsset.delete({ where: { id } });
    await deleteAsset(asset.storageKey);

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "media.deleted",
      target: `mediaAsset:${id}`,
      diff: { filename: asset.filename },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

// Move a file to a folder (folderId: string) or back to "All files" (folderId: null).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const body = (await req.json().catch(() => ({}))) as { folderId?: string | null };

    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundError("Asset not found");

    let folderId: string | null = null;
    if (body.folderId) {
      const folder = await db.mediaFolder.findUnique({ where: { id: body.folderId } });
      if (!folder) return NextResponse.json({ error: "FOLDER_NOT_FOUND" }, { status: 404 });
      folderId = folder.id;
    }
    await db.mediaAsset.update({ where: { id }, data: { folderId } });
    return NextResponse.json({ ok: true, folderId });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
