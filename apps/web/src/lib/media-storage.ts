import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { MediaKind } from "@evo/db";

export { mediaPublicBaseUrl, assetPublicUrl } from "@evo/shared";

/** Base directory for uploads. Override with UPLOAD_DIR env var. */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

/** Maps a mimetype to a MediaKind. Defaults to "document". */
export function detectKind(mimetype: string): MediaKind {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
}

/**
 * Writes raw bytes to disk under <uploadDir>/<workspaceId>/<cuid>-<filename>.
 * Returns the relative storageKey (used as the DB field).
 */
export async function writeAsset(
  workspaceId: string,
  filename: string,
  bytes: Uint8Array
): Promise<{ storageKey: string; sizeBytes: number }> {
  const dir = path.join(uploadDir(), workspaceId);
  await mkdir(dir, { recursive: true });
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = path.join(workspaceId, `${randomUUID()}-${safeFilename}`);
  const fullPath = path.join(uploadDir(), storageKey);
  await writeFile(fullPath, bytes);
  return { storageKey, sizeBytes: bytes.byteLength };
}

/** Reads file bytes from disk using the stored storageKey. */
export async function readAsset(storageKey: string): Promise<Buffer> {
  return readFile(path.join(uploadDir(), storageKey));
}

/** Deletes the file from disk. Does not throw if already missing. */
export async function deleteAsset(storageKey: string): Promise<void> {
  try {
    await unlink(path.join(uploadDir(), storageKey));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
}

