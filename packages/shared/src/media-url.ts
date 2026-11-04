/**
 * Resolves the public base URL that Evolution can reach to fetch media.
 * In docker-compose the web container is reachable at http://web:3000.
 * Set MEDIA_PUBLIC_BASE_URL=http://web:3000 in the service env.
 * Falls back to AUTH_URL (the canonical public origin) for local dev.
 */
export function mediaPublicBaseUrl(): string {
  return (
    process.env.MEDIA_PUBLIC_BASE_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  );
}

/**
 * Returns the public URL for a MediaAsset given its workspace slug and asset id.
 * Evolution fetches this URL server-to-server.
 */
export function assetPublicUrl(workspaceSlug: string, assetId: string): string {
  const base = mediaPublicBaseUrl().replace(/\/$/, "");
  return `${base}/api/workspaces/${workspaceSlug}/media/${assetId}/raw`;
}
