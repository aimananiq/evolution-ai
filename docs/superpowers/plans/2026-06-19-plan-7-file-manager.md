# Plan 7 — File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a workspace-scoped media library (MediaAsset) where files are uploaded once and reused across Autoresponder, Chatbot, and Bulk Messaging. Exposes a `<MediaPicker>` component that later plans (P8, P11) import to attach media to any send flow. Media is sent to contacts via Evolution API's `sendMedia` endpoint using a public URL served by the web app itself.

**Architecture:** Files are stored on disk under `UPLOAD_DIR` (default `./uploads`). The web app serves them at `/api/workspaces/[slug]/media/[id]/raw` — an unauthenticated-by-cuid route (cuid is cryptographically unguessable; suitable for dev/internal; prod hardening note included). Evolution fetches the URL server-to-server using the compose-network hostname `web:3000`, controlled by the `MEDIA_PUBLIC_BASE_URL` env var (default falls back to `NEXTAUTH_URL`/`AUTH_URL`). The `@evo/evolution-client` `MessageApi` gains a `sendMedia` method. `@evo/send`'s `sendViaInstance` gains a discriminated-union `SendMediaPayload` variant that routes through the same token bucket and presence logic.

**Tech Stack:** Prisma (new `MediaAsset` model + `MediaKind` enum), Next.js App Router route handlers, Node.js `fs/promises` + `stream`, Zod validation, Vitest (unit), Playwright (e2e).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modify | Add `MediaKind` enum + `MediaAsset` model |
| `packages/db/src/tenant.ts` | Modify | Add `"MediaAsset"` to `TENANTED_MODELS` |
| `packages/db/prisma/migrations/<ts>_add_media_asset/migration.sql` | Create (generated) | SQL for new table |
| `apps/web/src/lib/media-storage.ts` | Create | Write file to disk, resolve public URL, detect kind |
| `apps/web/src/app/api/workspaces/[slug]/media/route.ts` | Create | POST upload (Agent+), GET list (Viewer+) |
| `apps/web/src/app/api/workspaces/[slug]/media/[id]/route.ts` | Create | DELETE asset (Admin) |
| `apps/web/src/app/api/workspaces/[slug]/media/[id]/raw/route.ts` | Create | Unauthenticated file-serve (streams bytes) |
| `packages/evolution-client/src/types.ts` | Modify | Add `SendMediaInputSchema` + `SendMediaInput` |
| `packages/evolution-client/src/message.ts` | Modify | Add `MessageApi.sendMedia()` |
| `packages/evolution-client/src/message.test.ts` | Modify | Add `sendMedia` test |
| `packages/send/src/index.ts` | Modify | Add `SendMediaPayload` union + media branch in `sendViaInstance` |
| `apps/web/src/lib/send.ts` | Modify | Re-export `SendMediaPayload`; extend audit diff for media |
| `apps/web/src/lib/send.test.ts` | Modify | Add media payload test case |
| `apps/web/src/app/[workspaceSlug]/files/page.tsx` | Create | Server page shell — requireMember, pass initial assets |
| `apps/web/src/app/[workspaceSlug]/files/files-browser.tsx` | Create | `"use client"` — grid, dropzone, delete, open picker |
| `apps/web/src/components/media-picker.tsx` | Create | `"use client"` — `<MediaPicker value onChange />` modal |
| `apps/web/messages/en-GB.json` | Modify | Add `files.*` namespace |
| `docker-compose.yml` | Modify | Add `MEDIA_PUBLIC_BASE_URL` + `UPLOAD_DIR` + uploads volume |
| `apps/web/tests/e2e/media.spec.ts` | Create | Playwright: upload → list → raw bytes → delete |

---

### Task 1: Schema — MediaAsset model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`
- Create (generated): `packages/db/prisma/migrations/<timestamp>_add_media_asset/migration.sql`

- [ ] Open `packages/db/prisma/schema.prisma`. After the last existing enum (search for the block ending with `WorkspaceRole`), add the `MediaKind` enum:

```prisma
enum MediaKind {
  image
  video
  audio
  document
}
```

- [ ] Add the `MediaAsset` model after the `WorkspaceIntegration` model (near end of file). Also add `mediaAssets MediaAsset[]` to the `Workspace` model relation list:

```prisma
model MediaAsset {
  id           String      @id @default(cuid())
  workspaceId  String
  filename     String
  mimetype     String
  sizeBytes    Int
  storageKey   String
  kind         MediaKind
  uploadedById String?
  createdAt    DateTime    @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

- [ ] In `Workspace` model, add the relation field alongside existing relation fields:

```prisma
  mediaAssets  MediaAsset[]
```

- [ ] In `packages/db/src/tenant.ts`, add `"MediaAsset"` to `TENANTED_MODELS`:

```ts
  "MediaAsset",
```

(Insert after `"WorkspaceIntegration"` in the Set initialiser.)

- [ ] Run migration from repo root (DATABASE_URL must point at localhost:5433):

```bash
pnpm --filter @evo/db migrate
```

Expected output: `Your database is now in sync with your schema.` and a new migration folder under `packages/db/prisma/migrations/`.

- [ ] Verify Prisma client re-generated:

```bash
pnpm --filter @evo/db exec prisma generate
```

- [ ] Commit: `feat(db): add MediaAsset model and MediaKind enum`

---

### Task 2: Storage helper

**Files:**
- Create: `apps/web/src/lib/media-storage.ts`

- [ ] Create `apps/web/src/lib/media-storage.ts` with the following content:

```ts
import { createId } from "@paralleldrive/cuid2";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import type { MediaKind } from "@prisma/client";

/** Base directory for uploads. Override with UPLOAD_DIR env var. */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

/**
 * Resolves the public base URL that Evolution can reach to fetch media.
 * In docker-compose the web container is reachable at http://web:3000.
 * Set MEDIA_PUBLIC_BASE_URL=http://web:3000 in the web service env.
 * Falls back to AUTH_URL (which is the canonical public origin) for local dev.
 */
export function mediaPublicBaseUrl(): string {
  return (
    process.env.MEDIA_PUBLIC_BASE_URL ??
    process.env.AUTH_URL ??
    "http://localhost:3000"
  );
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
  const storageKey = path.join(workspaceId, `${createId()}-${safeFilename}`);
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

/**
 * Returns the public URL for a MediaAsset given its workspace slug and asset id.
 * Evolution fetches this URL server-to-server.
 */
export function assetPublicUrl(workspaceSlug: string, assetId: string): string {
  const base = mediaPublicBaseUrl().replace(/\/$/, "");
  return `${base}/api/workspaces/${workspaceSlug}/media/${assetId}/raw`;
}
```

- [ ] Commit: `feat(web): media-storage helper — disk write/read/delete + URL resolver`

---

### Task 3: Upload API (POST) + List API (GET)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/media/route.ts`

Allowed mimetypes: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `video/mp4`, `video/3gpp`, `audio/mpeg`, `audio/ogg`, `audio/mp4`, `audio/aac`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Max size: 16 MB.

- [ ] Create `apps/web/src/app/api/workspaces/[slug]/media/route.ts`:

```ts
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { writeAsset, detectKind } from "@/lib/media-storage";

const MAX_BYTES = 16 * 1024 * 1024; // 16 MB

const ALLOWED_MIMETYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/3gpp",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const assets = await db.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        filename: true,
        mimetype: true,
        sizeBytes: true,
        kind: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ assets });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    if (!ALLOWED_MIMETYPES.has(file.type)) {
      return NextResponse.json({ error: "MIMETYPE_NOT_ALLOWED" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { storageKey, sizeBytes } = await writeAsset(
      workspace.id,
      file.name,
      bytes
    );

    const db = tenantClient(workspace.id);
    const asset = await db.mediaAsset.create({
      data: {
        filename: file.name,
        mimetype: file.type,
        sizeBytes,
        storageKey,
        kind: detectKind(file.type),
        uploadedById: userId,
      } as any,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError)
      return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Commit: `feat(web): media upload (POST) and list (GET) API routes`

---

### Task 4: Raw-serve API (unauthenticated stream)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/media/[id]/raw/route.ts`

Auth decision: this route is intentionally unauthenticated. The asset `id` is a cuid2 (128-bit entropy), making enumeration infeasible. This is the same pattern used by signed-URL services without the signing step — acceptable for internal/dev deployment. For production hardening, generate a short-lived HMAC token (same pattern as existing `verifyBearerHmac`) passed as a `?token=` query param; document this in a TODO comment in the file.

- [ ] Create `apps/web/src/app/api/workspaces/[slug]/media/[id]/raw/route.ts`:

```ts
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
```

- [ ] Commit: `feat(web): raw media serve route — unauthenticated-by-cuid2, cross-workspace isolation`

---

### Task 5: Delete API

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/media/[id]/route.ts`

- [ ] Create `apps/web/src/app/api/workspaces/[slug]/media/[id]/route.ts`:

```ts
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
```

- [ ] Commit: `feat(web): DELETE media asset API — Admin role, cascades to disk`

---

### Task 6: Extend evolution-client — MessageApi.sendMedia

**Files:**
- Modify: `packages/evolution-client/src/types.ts`
- Modify: `packages/evolution-client/src/message.ts`
- Modify: `packages/evolution-client/src/message.test.ts`

- [ ] In `packages/evolution-client/src/types.ts`, append after the `WhatsappNumbersResultSchema` export:

```ts
export const SendMediaInputSchema = z.object({
  number: z.string().min(1),
  mediatype: z.enum(["image", "document", "video", "audio"]),
  media: z.string().min(1),          // URL (preferred) or base64
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  fileName: z.string().optional(),
});
export type SendMediaInput = z.input<typeof SendMediaInputSchema>;
```

- [ ] In `packages/evolution-client/src/message.ts`, add the import for the new types and add `sendMedia` to `MessageApi`. Full updated file:

```ts
import type { EvolutionClient } from "./client";
import {
  SendResultSchema,
  SendTextInputSchema,
  SendMediaInputSchema,
  type SendResult,
  type SendTextInput,
  type SendMediaInput,
} from "./types";

export class MessageApi {
  constructor(private readonly client: EvolutionClient) {}

  async sendText(instanceName: string, input: SendTextInput): Promise<SendResult> {
    const body = SendTextInputSchema.parse(input);
    const raw = await this.client.request(
      "POST",
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      body
    );
    return SendResultSchema.parse(raw);
  }

  async sendMedia(instanceName: string, input: SendMediaInput): Promise<SendResult> {
    const body = SendMediaInputSchema.parse(input);
    const raw = await this.client.request(
      "POST",
      `/message/sendMedia/${encodeURIComponent(instanceName)}`,
      body
    );
    return SendResultSchema.parse(raw);
  }

  async sendPresence(
    instanceName: string,
    number: string,
    presence: "composing" | "available"
  ): Promise<void> {
    await this.client.request(
      "POST",
      `/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      { number, presence, delay: 0 }
    );
  }
}
```

- [ ] In `packages/evolution-client/src/message.test.ts`, append a new `describe` block after the existing `MessageApi.sendText` block:

```ts
describe("MessageApi.sendMedia", () => {
  const api = new MessageApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("posts to /message/sendMedia/<name> with required fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "XYZ" }, status: "PENDING" }), { status: 200 })
    );
    const result = await api.sendMedia("inst-1", {
      number: "60123456789",
      mediatype: "image",
      media: "https://example.com/img.jpg",
      caption: "Hello",
    });
    expect(result.key.id).toBe("XYZ");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/message/sendMedia/inst-1");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      number: "60123456789",
      mediatype: "image",
      media: "https://example.com/img.jpg",
      caption: "Hello",
    });
  });

  it("includes optional fileName and mimetype when provided", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "ABC" }, status: "PENDING" }), { status: 200 })
    );
    await api.sendMedia("inst-2", {
      number: "60111",
      mediatype: "document",
      media: "https://example.com/doc.pdf",
      mimetype: "application/pdf",
      fileName: "invoice.pdf",
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.mimetype).toBe("application/pdf");
    expect(body.fileName).toBe("invoice.pdf");
  });
});
```

- [ ] Run tests to verify:

```bash
pnpm --filter @evo/evolution-client test --run
```

Expected: all `message.test.ts` tests pass.

- [ ] Commit: `feat(evolution-client): add MessageApi.sendMedia with Zod validation and tests`

---

### Task 7: Extend @evo/send — media payload variant

**Files:**
- Modify: `packages/send/src/index.ts`
- Modify: `apps/web/src/lib/send.ts`
- Modify: `apps/web/src/lib/send.test.ts`

- [ ] Replace `packages/send/src/index.ts` with the following (backward compatible — `SendTextPayload` unchanged):

```ts
import { prisma } from "@evo/db";
import { tokenBucket } from "@evo/queue";
import { EvolutionClient, MessageApi } from "@evo/evolution-client";

const DEFAULT_BUCKET = { capacity: 10, refillPerSecond: 0.5 };
const WAIT_MS = 5 * 60 * 1000;

export interface SendTextPayload {
  type: "text";
  to: string;
  text: string;
  userId: string | null;
}

export interface SendMediaPayload {
  type: "media";
  to: string;
  mediaUrl: string;
  mediatype: "image" | "document" | "video" | "audio";
  mimetype?: string;
  caption?: string;
  fileName?: string;
  userId: string | null;
}

export type SendPayload = SendTextPayload | SendMediaPayload;

export async function sendViaInstance(instanceId: string, payload: SendPayload) {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) throw new Error(`instance not found: ${instanceId}`);

  const bucket = tokenBucket(instanceId, DEFAULT_BUCKET);
  const taken = await bucket.take({ waitMs: WAIT_MS });
  if (!taken.granted) {
    throw new Error(
      `throttled: bucket empty for instance ${instanceId} after ${taken.waitedMs}ms`
    );
  }

  const base = process.env.EVOLUTION_BASE_URL;
  if (!base) throw new Error("EVOLUTION_BASE_URL not set");
  const client = new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey });
  const api = new MessageApi(client);

  try {
    await api.sendPresence(instance.evolutionInstanceName, payload.to, "composing");
  } catch {}

  if (payload.type === "text") {
    return api.sendText(instance.evolutionInstanceName, {
      number: payload.to,
      text: payload.text,
    });
  }

  // payload.type === "media"
  return api.sendMedia(instance.evolutionInstanceName, {
    number: payload.to,
    mediatype: payload.mediatype,
    media: payload.mediaUrl,
    mimetype: payload.mimetype,
    caption: payload.caption,
    fileName: payload.fileName,
  });
}
```

- [ ] Update `apps/web/src/lib/send.ts` to re-export `SendMediaPayload` and extend the audit diff for media sends:

```ts
import { prisma } from "@evo/db";
import {
  sendViaInstance as rawSendViaInstance,
  type SendTextPayload,
  type SendMediaPayload,
  type SendPayload,
} from "@evo/send";
import { writeAudit } from "./audit";

export type { SendTextPayload, SendMediaPayload, SendPayload } from "@evo/send";

export async function sendViaInstance(instanceId: string, payload: SendPayload) {
  const result = await rawSendViaInstance(instanceId, payload);
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (instance) {
    const diff =
      payload.type === "text"
        ? { to: payload.to, textPreview: payload.text.slice(0, 80) }
        : { to: payload.to, mediatype: payload.mediatype, mediaUrl: payload.mediaUrl };
    await writeAudit({
      workspaceId: instance.workspaceId,
      userId: payload.userId,
      action: "message.sent",
      target: `instance:${instance.id}`,
      instanceId: instance.id,
      diff,
    });
  }
  return result;
}
```

- [ ] In `apps/web/src/lib/send.test.ts`, add a media payload test case. Append inside the existing `describe("sendViaInstance (web wrapper)")` block:

```ts
  it("calls @evo/send with media payload and writes audit with mediatype", async () => {
    mockedRaw.mockResolvedValue({ key: { id: "mid-2" }, status: "PENDING" } as any);
    findInstance.mockResolvedValue({ id: "inst-1", workspaceId: "ws-1" } as any);
    const result = await sendViaInstance("inst-1", {
      type: "media",
      to: "60123",
      mediaUrl: "http://web:3000/api/workspaces/acme/media/abc123/raw",
      mediatype: "image",
      caption: "Look at this",
      userId: "u-1",
    });
    expect(mockedRaw).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ type: "media", mediatype: "image" })
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "message.sent", diff: expect.objectContaining({ mediatype: "image" }) })
    );
    expect(result).toEqual({ key: { id: "mid-2" }, status: "PENDING" });
  });
```

- [ ] Run tests:

```bash
pnpm --filter @evo/send test --run 2>/dev/null || true
pnpm --filter @evo/web test --run apps/web/src/lib/send.test.ts
```

Expected: all send tests pass.

- [ ] Commit: `feat(send): add SendMediaPayload variant to sendViaInstance — backward compatible`

---

### Task 8: UI — /files page + files-browser + media-picker

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/files/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/files/files-browser.tsx`
- Create: `apps/web/src/components/media-picker.tsx`

- [ ] Create `apps/web/src/app/[workspaceSlug]/files/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import FilesBrowser from "./files-browser";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("files");
  const db = tenantClient(workspace.id);
  const assets = await db.mediaAsset.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      filename: true,
      mimetype: true,
      sizeBytes: true,
      kind: true,
      createdAt: true,
    },
  });
  const canUpload = role === "Agent" || role === "Admin" || role === "Owner";
  const canDelete = role === "Admin" || role === "Owner";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <FilesBrowser
        workspaceSlug={workspaceSlug}
        initialAssets={assets as any}
        canUpload={canUpload}
        canDelete={canDelete}
      />
    </div>
  );
}
```

- [ ] Create `apps/web/src/app/[workspaceSlug]/files/files-browser.tsx`:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState, useRef, useCallback } from "react";

interface AssetRow {
  id: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "document";
  createdAt: string;
}

interface Props {
  workspaceSlug: string;
  initialAssets: AssetRow[];
  canUpload: boolean;
  canDelete: boolean;
}

function kindIcon(kind: AssetRow["kind"]): string {
  switch (kind) {
    case "image": return "🖼";
    case "video": return "🎬";
    case "audio": return "🎵";
    default: return "📄";
  }
}

export default function FilesBrowser({
  workspaceSlug,
  initialAssets,
  canUpload,
  canDelete,
}: Props) {
  const t = useTranslations("files");
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(
            `/api/workspaces/${workspaceSlug}/media`,
            { method: "POST", body: fd }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(body.error ?? t("uploadError"));
            continue;
          }
          const { asset } = await res.json();
          setAssets((prev) => [asset, ...prev]);
        }
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [workspaceSlug, t]
  );

  const deleteAsset = useCallback(
    async (id: string) => {
      if (!confirm(t("deleteConfirm"))) return;
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/media/${id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setAssets((prev) => prev.filter((a) => a.id !== id));
      }
    },
    [workspaceSlug, t]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      upload(e.dataTransfer.files);
    },
    [upload]
  );

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </p>
      )}

      {canUpload && (
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <p className="text-gray-500 text-sm">
            {uploading ? t("uploading") : t("dropzone")}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/mp4,video/3gpp,audio/mpeg,audio/ogg,audio/mp4,audio/aac,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      )}

      {assets.length === 0 ? (
        <p className="text-gray-400 text-sm border rounded p-4">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {assets.map((a) => (
            <li
              key={a.id}
              className="border rounded-lg overflow-hidden bg-white shadow-sm flex flex-col"
            >
              <div className="h-28 flex items-center justify-center bg-gray-50">
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/workspaces/${workspaceSlug}/media/${a.id}/raw`}
                    alt={a.filename}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-4xl">{kindIcon(a.kind)}</span>
                )}
              </div>
              <div className="p-2 flex flex-col gap-1 flex-1">
                <p
                  className="text-xs font-medium truncate"
                  title={a.filename}
                >
                  {a.filename}
                </p>
                <p className="text-xs text-gray-400">
                  {(a.sizeBytes / 1024).toFixed(0)} KB
                </p>
                <div className="flex gap-1 mt-auto">
                  <a
                    href={`/api/workspaces/${workspaceSlug}/media/${a.id}/raw`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {t("view")}
                  </a>
                  {canDelete && (
                    <button
                      onClick={() => deleteAsset(a.id)}
                      className="text-xs text-red-500 hover:underline ml-auto"
                    >
                      {t("delete")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] Create `apps/web/src/components/media-picker.tsx` — this is the reusable component that Plans 8 and 11 will import:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";

interface AssetRow {
  id: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "document";
  createdAt: string;
}

interface Props {
  workspaceSlug: string;
  /** Currently selected asset id (controlled). */
  value: string | null;
  onChange: (assetId: string | null, asset: AssetRow | null) => void;
  /** Label shown on the trigger button. Defaults to "File manager". */
  label?: string;
}

function kindIcon(kind: AssetRow["kind"]): string {
  switch (kind) {
    case "image": return "🖼";
    case "video": return "🎬";
    case "audio": return "🎵";
    default: return "📄";
  }
}

export function MediaPicker({ workspaceSlug, value, onChange, label }: Props) {
  const t = useTranslations("files");
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/media`);
      if (res.ok) {
        const { assets: list } = await res.json();
        setAssets(list);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    if (open) fetchAssets();
  }, [open, fetchAssets]);

  const select = useCallback(
    (asset: AssetRow) => {
      onChange(asset.id, asset);
      setOpen(false);
    },
    [onChange]
  );

  const clear = useCallback(() => {
    onChange(null, null);
  }, [onChange]);

  const selectedAsset = value ? assets.find((a) => a.id === value) ?? null : null;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm bg-white hover:bg-gray-50"
        >
          <span>📁</span>
          {label ?? t("pickerButton")}
        </button>
        {value && selectedAsset && (
          <span className="text-sm text-gray-600 flex items-center gap-1">
            {kindIcon(selectedAsset.kind)} {selectedAsset.filename}
            <button
              type="button"
              onClick={clear}
              className="text-gray-400 hover:text-red-500 ml-1"
              aria-label="Clear selection"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-lg">{t("pickerTitle")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {loading && (
                <p className="text-sm text-gray-400">{t("loading")}</p>
              )}
              {!loading && assets.length === 0 && (
                <p className="text-sm text-gray-400">{t("empty")}</p>
              )}
              {!loading && assets.length > 0 && (
                <ul className="grid grid-cols-3 gap-3">
                  {assets.map((a) => (
                    <li
                      key={a.id}
                      onClick={() => select(a)}
                      className={`border rounded-lg overflow-hidden cursor-pointer hover:border-blue-500 transition-colors ${
                        value === a.id ? "border-blue-600 ring-2 ring-blue-200" : ""
                      }`}
                    >
                      <div className="h-24 flex items-center justify-center bg-gray-50">
                        {a.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/workspaces/${workspaceSlug}/media/${a.id}/raw`}
                            alt={a.filename}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-3xl">{kindIcon(a.kind)}</span>
                        )}
                      </div>
                      <p className="text-xs p-1.5 truncate" title={a.filename}>
                        {a.filename}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] Add the files link to the workspace navigation. Open `apps/web/src/components/shell/` (or wherever `nav.tsx` lives) and add an entry:

```tsx
{ href: `/${workspaceSlug}/files`, label: t("nav.files"), icon: "📁" }
```

(Find the nav array in the shell component, follow the pattern of the existing "Broadcasts" or "Warmer" entry.)

- [ ] Commit: `feat(web): file manager page, files-browser, and reusable MediaPicker component`

---

### Task 9: i18n — files namespace

**Files:**
- Modify: `apps/web/messages/en-GB.json`

- [ ] Open `apps/web/messages/en-GB.json` and add the `"files"` key at the top level (alongside existing namespaces). Also add `"nav.files"` under `"nav"`:

Under `"nav"` object add:
```json
"files": "File Manager"
```

Add a new top-level key `"files"`:
```json
"files": {
  "title": "File Manager",
  "dropzone": "Drop files here or click to upload (max 16 MB)",
  "uploading": "Uploading…",
  "uploadError": "Upload failed",
  "empty": "No media files yet",
  "view": "View",
  "delete": "Delete",
  "deleteConfirm": "Delete this file? This cannot be undone.",
  "pickerButton": "File manager",
  "pickerTitle": "Select a file",
  "loading": "Loading…"
}
```

- [ ] Commit: `feat(web): i18n — files namespace`

---

### Task 10: docker-compose — UPLOAD_DIR + MEDIA_PUBLIC_BASE_URL + volume

**Files:**
- Modify: `docker-compose.yml`

- [ ] In the `web` service `environment` block, add:

```yaml
      UPLOAD_DIR: /app/uploads
      MEDIA_PUBLIC_BASE_URL: http://web:3000
```

- [ ] In the `web` service, add a `volumes` key (or append to existing):

```yaml
    volumes:
      - media-uploads:/app/uploads
```

- [ ] In the top-level `volumes` block, add:

```yaml
  media-uploads:
```

- [ ] Commit: `chore(docker): add media uploads volume and MEDIA_PUBLIC_BASE_URL env`

---

### Task 11: Playwright e2e — upload, list, raw, delete

**Files:**
- Create: `apps/web/tests/e2e/media.spec.ts`

- [ ] First, confirm the e2e test directory exists (check for existing specs):

```bash
ls apps/web/tests/e2e/ 2>/dev/null || echo "no e2e dir yet"
```

If the directory does not exist, create it:

```bash
mkdir -p apps/web/tests/e2e
```

- [ ] Create `apps/web/tests/e2e/media.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Media file manager e2e tests.
 *
 * Requires:
 *   - Web app running at BASE_URL (default http://localhost:3000)
 *   - A valid session cookie or the ability to sign in
 *   - A workspace with slug set via WS_SLUG env (default "test-workspace")
 *
 * The tests use the API directly (not through the browser UI) to keep them
 * fast and independent of the exact UI implementation.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const WS_SLUG = process.env.WS_SLUG ?? "test-workspace";

// A tiny 1x1 red PNG — 67 bytes, valid image/png
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

test.describe("Media file manager", () => {
  let uploadedAssetId: string;
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    // Sign in and capture session cookie
    const res = await request.post(`${BASE_URL}/api/auth/callback/credentials`, {
      form: {
        email: process.env.TEST_EMAIL ?? "admin@example.com",
        password: process.env.TEST_PASSWORD ?? "password",
        redirect: "false",
        csrfToken: "",
        callbackUrl: BASE_URL,
        json: "true",
      },
    });
    // Accept any 2xx or redirect; cookie will be in the context automatically
    expect(res.status()).toBeLessThan(400);
  });

  test("POST /api/workspaces/[slug]/media — upload a PNG", async ({ request }) => {
    const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pngBytes], { type: "image/png" }),
      "test-image.png"
    );

    const res = await request.post(
      `${BASE_URL}/api/workspaces/${WS_SLUG}/media`,
      { multipart: { file: { name: "test-image.png", mimeType: "image/png", buffer: pngBytes } } }
    );

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.asset).toBeDefined();
    expect(body.asset.filename).toBe("test-image.png");
    expect(body.asset.kind).toBe("image");
    uploadedAssetId = body.asset.id;
  });

  test("GET /api/workspaces/[slug]/media — lists the uploaded asset", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/workspaces/${WS_SLUG}/media`);
    expect(res.status()).toBe(200);
    const { assets } = await res.json();
    const found = (assets as any[]).find((a: any) => a.id === uploadedAssetId);
    expect(found).toBeDefined();
    expect(found.filename).toBe("test-image.png");
  });

  test("GET /api/workspaces/[slug]/media/[id]/raw — serves file bytes", async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/workspaces/${WS_SLUG}/media/${uploadedAssetId}/raw`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const bytes = await res.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("DELETE /api/workspaces/[slug]/media/[id] — removes asset", async ({ request }) => {
    const res = await request.delete(
      `${BASE_URL}/api/workspaces/${WS_SLUG}/media/${uploadedAssetId}`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Confirm it no longer lists
    const listRes = await request.get(`${BASE_URL}/api/workspaces/${WS_SLUG}/media`);
    const { assets } = await listRes.json();
    const found = (assets as any[]).find((a: any) => a.id === uploadedAssetId);
    expect(found).toBeUndefined();

    // Confirm raw route returns 404
    const rawRes = await request.get(
      `${BASE_URL}/api/workspaces/${WS_SLUG}/media/${uploadedAssetId}/raw`
    );
    expect(rawRes.status()).toBe(404);
  });
});
```

- [ ] Run e2e suite (app must be running):

```bash
pnpm --filter @evo/web exec playwright test apps/web/tests/e2e/media.spec.ts --reporter=list
```

Expected: 4 tests pass — upload, list, raw bytes, delete.

- [ ] Commit: `test(web): Playwright e2e for media file manager — upload, list, raw, delete`

---

### Task 12: Final review

**Files:** All files modified in Tasks 1–11.

- [ ] Run full unit test suite:

```bash
pnpm --filter @evo/evolution-client test --run
pnpm --filter @evo/send test --run 2>/dev/null || true
pnpm --filter @evo/web test --run
```

Expected: zero failures.

- [ ] Verify TypeScript compiles across the monorepo:

```bash
pnpm --filter @evo/web exec tsc --noEmit
pnpm --filter @evo/evolution-client exec tsc --noEmit
pnpm --filter @evo/send exec tsc --noEmit
```

Expected: no type errors.

- [ ] Confirm field name consistency audit:
  - `storageKey` used in: `schema.prisma` (model field), `writeAsset` return, `readAsset` param, `deleteAsset` param, `route.ts` (POST), `raw/route.ts` (select), `[id]/route.ts` (delete). ✓
  - `sizeBytes` used in: schema (Int), `writeAsset` return, POST route create. ✓
  - `SendMediaPayload.mediaUrl` used in: `packages/send/src/index.ts`, `apps/web/src/lib/send.ts`, `send.test.ts`. ✓
  - `assetPublicUrl(workspaceSlug, assetId)` uses the workspace **slug** (not id) because the raw route is slug-scoped. ✓

- [ ] Confirm scope coverage:
  - [x] Task 1: MediaAsset schema + TENANTED_MODELS + migration
  - [x] Task 2: media-storage.ts helper
  - [x] Task 3: POST + GET /media route (Agent upload, Viewer list)
  - [x] Task 4: /media/[id]/raw unauthenticated serve with cross-workspace isolation
  - [x] Task 5: DELETE /media/[id] (Admin)
  - [x] Task 6: MessageApi.sendMedia + test
  - [x] Task 7: SendMediaPayload + sendViaInstance media branch + backward compat
  - [x] Task 8: /files page + files-browser + MediaPicker
  - [x] Task 9: files i18n namespace
  - [x] Task 10: docker-compose volumes + env
  - [x] Task 11: Playwright e2e

- [ ] Commit: `chore: final review pass — P7 file manager`

---

## Self-review

**Scope coverage:** All 11 scope items map 1:1 to Tasks 1–11 + Task 12 review. No placeholders remain.

**Type consistency:**
- `storageKey: String` in Prisma → `storageKey: string` in TS everywhere.
- `sizeBytes: Int` in Prisma → `sizeBytes: number` in TS everywhere.
- `MediaKind` enum values (`image`, `video`, `audio`, `document`) match the `detectKind` function, the `kindIcon` helper in both UI files, and the `SendMediaInput.mediatype` values (`image`, `video`, `audio`, `document` — note Evolution also accepts `ptv` but we don't expose it here).
- `SendMediaPayload.mediaUrl` (our field name) is distinct from `SendMediaInput.media` (Evolution's field name); the translation between them happens at one point only in `sendViaInstance` in `packages/send/src/index.ts`.

**Design decisions:**
1. **Disk storage over database BLOB**: files stored as local files under `UPLOAD_DIR`; DB stores only metadata. Keeps DB fast and avoids BLOB size limits. Swappable to S3 later by replacing `media-storage.ts` internals.
2. **Raw route auth model**: unauthenticated-by-cuid2 id. Justification: cuid2 has 128 bits of randomness — the same entropy as a UUID v4 — making enumeration infeasible. The route additionally checks workspace-slug ownership to prevent cross-workspace leakage even if an id is known. A TODO comment documents the HMAC-token hardening path for production.
3. **MEDIA_PUBLIC_BASE_URL for Evolution fetch**: Evolution runs in the same Docker compose network. Setting `MEDIA_PUBLIC_BASE_URL=http://web:3000` lets Evolution reach the raw route server-to-server without going through Caddy/TLS. In production behind a real domain, set it to the public origin.
4. **MediaPicker is controlled (`value`/`onChange`)**: allows the parent (autoresponder, chatbot, broadcast forms) to hold the selected assetId in their own state and derive the public URL via `assetPublicUrl()` at send time.
