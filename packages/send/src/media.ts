import { prisma } from "@evo/db";
import { assetPublicUrl } from "@evo/shared";
import type { SendMediaPayload } from "./index";

/**
 * Resolves a MediaAsset (scoped to the workspace for cross-tenant safety) into a
 * SendMediaPayload whose URL Evolution fetches server-to-server.
 * Returns null when the asset does not exist — callers fall back to text.
 */
export async function mediaPayloadFromAsset(
  assetId: string,
  workspaceId: string,
  to: string,
  caption?: string,
): Promise<SendMediaPayload | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, workspaceId },
    select: { id: true, kind: true, mimetype: true, filename: true },
  });
  if (!asset) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true },
  });
  if (!workspace) return null;
  return {
    type: "media",
    to,
    mediaUrl: assetPublicUrl(workspace.slug, asset.id),
    mediatype: asset.kind,
    mimetype: asset.mimetype,
    caption: caption?.trim() ? caption : undefined,
    fileName: asset.filename,
    userId: null,
  };
}
