import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { readAsset } from "@/lib/media-storage";

/**
 * Serves the raw file bytes for a MediaAsset.
 *
 * AUTH NOTE: This route is intentionally unauthenticated. The asset `id` is a
 * cuid2 (128-bit entropy) which is unguessable — sufficient for internal use
 * where Evolution fetches media server-to-server. The route validates that the
 * asset belongs to the workspace identified by [slug] to prevent cross-workspace
 * leakage.
 *
 * TODO (prod hardening): Add a short-lived HMAC token query parameter
 * (e.g. ?token=<hmac-sha256(assetId + expiry, MEDIA_TOKEN_SECRET)>) and
 * verify it here, following the same pattern as apps/web/src/lib/socket-auth.ts.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;

  // Resolve workspace by slug without session (public route)
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // Asset must belong to this workspace (cross-workspace isolation)
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { storageKey: true, mimetype: true, filename: true },
  });
  if (!asset) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readAsset(asset.storageKey);
  } catch {
    return NextResponse.json({ error: "STORAGE_ERROR" }, { status: 500 });
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": asset.mimetype,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${asset.filename}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
