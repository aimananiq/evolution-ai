# Plan 2 — Inbox + realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest WhatsApp events from Evolution, push them to connected agents in real time, and let those agents reply inside a three-pane team inbox with assignments, internal notes, and quick replies.

**Architecture:** Evolution `POST /whatsapp/webhook/:workspaceId/:instanceId` → `apps/ingest` verifies an HMAC against the instance's `evolutionApiKey`, normalises the event, upserts `Conversation` + `Message` rows inside a transaction, then publishes the normalised event onto Redis pub/sub channel `events:{workspaceId}`. `apps/web` runs a custom Next.js Node server that mounts Socket.IO with the Redis adapter, authenticates connections via the Auth.js session cookie, joins membership-validated rooms, subscribes to the pub/sub channel, and fans events to the right rooms. The inbox UI loads history server-side, then appends realtime events from Socket.IO. Replies route through the same `sendViaInstance` chokepoint added in Plan 1.

**Tech Stack:** Inherits Plan 0 + Plan 1. Adds: `socket.io ^4.8.x` (server + Redis adapter), `socket.io-client ^4.8.x` (browser), `@socket.io/redis-adapter ^8.x`, `cookie ^0.6.x` (parse Auth.js session cookie at the Socket.IO handshake).

**Definition of done:**
1. An admin pairs an instance (Plan 1 flow) and Evolution is automatically configured to POST events to our ingest with a unique signed URL per instance.
2. An incoming WhatsApp message produces a new `Conversation` (if needed) and a `Message` row within ~100 ms p95.
3. Agents connected to the inbox see the new message appear without refreshing.
4. An agent can send a reply from the inbox; it routes through `sendViaInstance` and the outbound `Message` row is created with the Evolution message id reconciled on the `SEND_MESSAGE` event.
5. An agent can assign a conversation to a user, add an internal note, insert a quick reply, and change status (`open | pending | resolved`).
6. Plan 1's tests and Plan 0's tests still pass. New tests added: `@evo/ingest` 5+, normalisation 4+, hmac 2+, socket auth 3+, web routes 4+.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — sections 1 (Messaging tables, Team inbox tables), 3 (realtime fan-out, ingest hot path), 4 (webhook event list we consume).

---

## File structure produced by this plan

```
/
├─ packages/
│  ├─ db/prisma/schema.prisma                                       # MODIFIED: add 5 tables + enum
│  ├─ db/prisma/migrations/<ts>_inbox/migration.sql                 # NEW
│  ├─ db/src/tenant.ts                                              # MODIFIED: extend tenant set
│  ├─ evolution-client/src/webhook.ts                               # NEW: WebhookApi
│  ├─ evolution-client/src/webhook.test.ts                          # NEW
│  ├─ evolution-client/src/types.ts                                 # MODIFIED: webhook event union
│  └─ evolution-client/src/index.ts                                 # MODIFIED: export WebhookApi
├─ apps/
│  ├─ ingest/
│  │  ├─ package.json                                               # MODIFIED: add deps
│  │  └─ src/
│  │     ├─ index.ts                                                # MODIFIED: full pipeline
│  │     ├─ hmac.ts                                                 # NEW: verifySignature
│  │     ├─ hmac.test.ts                                            # NEW
│  │     ├─ normalise.ts                                            # NEW: Evolution → our shape
│  │     ├─ normalise.test.ts                                       # NEW
│  │     ├─ persist.ts                                              # NEW: upsert tx
│  │     ├─ persist.test.ts                                         # NEW
│  │     └─ publish.ts                                              # NEW: Redis pub/sub publish
│  └─ web/
│     ├─ server.ts                                                  # NEW: custom Node server hosting Next + Socket.IO
│     ├─ package.json                                               # MODIFIED: add deps + scripts
│     ├─ src/
│     │  ├─ lib/socket-auth.ts                                      # NEW: session cookie → user + memberships
│     │  ├─ lib/socket-auth.test.ts                                 # NEW
│     │  ├─ lib/socket.ts                                           # NEW: client-side Socket.IO singleton
│     │  ├─ app/[workspaceSlug]/inbox/page.tsx                      # NEW: layout + initial list
│     │  ├─ app/[workspaceSlug]/inbox/conversation-list.tsx         # NEW: client list
│     │  ├─ app/[workspaceSlug]/inbox/[conversationId]/page.tsx     # NEW: chat shell
│     │  ├─ app/[workspaceSlug]/inbox/[conversationId]/chat-pane.tsx # NEW: client chat
│     │  ├─ app/[workspaceSlug]/inbox/[conversationId]/reply-box.tsx # NEW: client reply form
│     │  ├─ app/[workspaceSlug]/inbox/[conversationId]/sidebar.tsx  # NEW: assign + notes + status
│     │  ├─ app/[workspaceSlug]/settings/quick-replies/page.tsx     # NEW: CRUD
│     │  ├─ app/[workspaceSlug]/settings/quick-replies/quick-replies-form.tsx
│     │  └─ app/api/workspaces/[slug]/conversations/
│     │     ├─ route.ts                                             # GET list
│     │     ├─ [id]/route.ts                                        # GET detail
│     │     ├─ [id]/messages/route.ts                               # GET history, POST reply
│     │     ├─ [id]/assign/route.ts                                 # POST assign/unassign
│     │     ├─ [id]/notes/route.ts                                  # GET/POST internal notes
│     │     └─ [id]/status/route.ts                                 # POST change status
│     │  └─ app/api/workspaces/[slug]/quick-replies/
│     │     ├─ route.ts                                             # GET list, POST create
│     │     └─ [id]/route.ts                                        # PUT update, DELETE
│     └─ messages/en-GB.json                                        # MODIFIED: inbox.*, notes.*, quickReplies.*
└─ tests/e2e/inbox-roundtrip.spec.ts                                # NEW: stub-Evolution → ingest webhook → inbox sees message → reply
```

Tasks below build this in order.

---

### Task 1: Schema — Conversation, Message, Assignment, InternalNote, QuickReply

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`
- New: `packages/db/prisma/migrations/<ts>_inbox/migration.sql`

- [ ] **Step 1: Append models to `schema.prisma`**

After the existing `AuditLog` model, append:

```prisma
enum MessageDirection {
  inbound
  outbound
}

enum MessageStatus {
  pending
  sent
  delivered
  read
  failed
}

enum ConversationStatus {
  open
  pending
  resolved
}

model Conversation {
  id                String             @id @default(cuid())
  workspaceId       String
  instanceId        String
  contactPhone      String
  contactName       String?
  lastMessageAt     DateTime           @default(now())
  unreadCount       Int                @default(0)
  status            ConversationStatus @default(open)
  assignedToUserId  String?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  messages  Message[]
  notes     InternalNote[]
  assignments Assignment[]

  @@unique([instanceId, contactPhone])
  @@index([workspaceId, lastMessageAt])
  @@index([assignedToUserId])
}

model Message {
  id                String           @id @default(cuid())
  workspaceId       String
  conversationId    String
  direction         MessageDirection
  evolutionMessageId String?         @unique
  type              String
  body              String?
  mediaUrl          String?
  status            MessageStatus    @default(pending)
  sentByUserId      String?
  sentAt            DateTime         @default(now())
  createdAt         DateTime         @default(now())

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([workspaceId, sentAt])
  @@index([conversationId, sentAt])
}

model Assignment {
  id              String   @id @default(cuid())
  workspaceId     String
  conversationId  String
  userId          String
  assignedAt      DateTime @default(now())

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, assignedAt])
}

model InternalNote {
  id              String   @id @default(cuid())
  workspaceId     String
  conversationId  String
  userId          String
  body            String
  createdAt       DateTime @default(now())

  workspace    Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}

model QuickReply {
  id          String   @id @default(cuid())
  workspaceId String
  shortcut    String
  body        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, shortcut])
  @@index([workspaceId])
}
```

Then add back-relations to `Workspace`:

```prisma
  conversations  Conversation[]
  messages       Message[]
  assignments    Assignment[]
  notes          InternalNote[]
  quickReplies   QuickReply[]
```

And add `conversations Conversation[]` to the `Instance` model's relations block.

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @evo/db exec prisma migrate dev --name inbox
```

If `migrate dev` errors due to host-Postgres conflict, use the docker-network workaround (same as previous tasks).

Verify a `<14-digit>_inbox/migration.sql` exists with `CREATE TABLE` statements for the five new tables.

- [ ] **Step 3: Extend tenant scope**

Edit `packages/db/src/tenant.ts`:

```typescript
const TENANTED_MODELS = new Set<string>([
  "Workspace",
  "WorkspaceMember",
  "Invitation",
  "Instance",
  "AuditLog",
  "Conversation",
  "Message",
  "Assignment",
  "InternalNote",
  "QuickReply",
]);
```

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @evo/db generate
DATABASE_URL="postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public" \
  pnpm --filter @evo/db exec prisma migrate deploy
pnpm --filter @evo/db test
```

Expected: 3/3 tenant tests still pass.

```bash
git add packages/db
git commit -m "feat(db): inbox schema (Conversation, Message, Assignment, InternalNote, QuickReply)"
```

---

### Task 2: Evolution-client — WebhookApi (TDD)

**Files:**
- New: `packages/evolution-client/src/webhook.ts`
- Test: `packages/evolution-client/src/webhook.test.ts`
- Modify: `packages/evolution-client/src/types.ts` (add webhook event union)
- Modify: `packages/evolution-client/src/index.ts` (export WebhookApi)

- [ ] **Step 1: Append to `types.ts`**

```typescript
export const WebhookEventSchema = z.enum([
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
  "CHATS_DELETE",
  "PRESENCE_UPDATE",
]);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WebhookSetInputSchema = z.object({
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    byEvents: z.boolean().optional().default(false),
    base64: z.boolean().optional().default(true),
    events: z.array(WebhookEventSchema),
  }),
});
export type WebhookSetInput = z.input<typeof WebhookSetInputSchema>;
```

- [ ] **Step 2: Failing test**

`packages/evolution-client/src/webhook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { WebhookApi } from "./webhook";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("WebhookApi.set", () => {
  it("posts to /webhook/set/<name> with the webhook payload", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ webhook: { enabled: true } }), { status: 200 }));
    const api = new WebhookApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.set("inst-1", {
      webhook: {
        enabled: true,
        url: "https://example.com/hook",
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/webhook/set/inst-1");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.webhook.url).toBe("https://example.com/hook");
    expect(body.webhook.events).toEqual(["MESSAGES_UPSERT", "CONNECTION_UPDATE"]);
  });
});
```

Run, verify FAIL:

```bash
pnpm --filter @evo/evolution-client test
```

- [ ] **Step 3: Implement `webhook.ts`**

```typescript
import type { EvolutionClient } from "./client";
import { WebhookSetInputSchema, type WebhookSetInput } from "./types";

export class WebhookApi {
  constructor(private readonly client: EvolutionClient) {}

  async set(instanceName: string, input: WebhookSetInput): Promise<void> {
    const body = WebhookSetInputSchema.parse(input);
    await this.client.request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, body);
  }

  async find(instanceName: string): Promise<unknown> {
    return this.client.request("GET", `/webhook/find/${encodeURIComponent(instanceName)}`);
  }
}
```

- [ ] **Step 4: Update `index.ts`**

```typescript
export { WebhookApi } from "./webhook";
```

(Append to the existing export list.)

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @evo/evolution-client test
```

Expected: 12/12 passing.

```bash
git add packages/evolution-client
git commit -m "feat(evolution-client): WebhookApi (set/find) with zod schema"
```

---

### Task 3: Auto-configure Evolution webhook on instance create

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[slug]/instances/route.ts`

- [ ] **Step 1: After the local `db.instance.create`, configure Evolution to webhook us**

Edit the POST handler in `apps/web/src/app/api/workspaces/[slug]/instances/route.ts`. After the `await db.instance.create(...)` block and before `writeAudit`, insert:

```typescript
    const webhookBase = process.env.WEBHOOK_PUBLIC_BASE_URL;
    if (webhookBase) {
      const webhookUrl = `${webhookBase.replace(/\/$/, "")}/whatsapp/webhook/${workspace.id}/${instance.id}`;
      const { WebhookApi } = await import("@evo/evolution-client");
      const webhook = new WebhookApi(new EvolutionClient({ baseUrl: base, apiKey: apiKey }));
      try {
        await webhook.set(evolutionName, {
          webhook: {
            enabled: true,
            url: webhookUrl,
            events: [
              "MESSAGES_UPSERT",
              "MESSAGES_UPDATE",
              "SEND_MESSAGE",
              "CONNECTION_UPDATE",
              "QRCODE_UPDATED",
              "CONTACTS_UPSERT",
              "CHATS_UPSERT",
              "PRESENCE_UPDATE",
            ],
          },
        });
      } catch (err) {
        // Webhook config is best-effort at create time. The user can re-trigger
        // it later from the instance detail page (Plan 2 deferred).
      }
    }
```

- [ ] **Step 2: typecheck and commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/instances/route.ts"
git commit -m "feat(web): auto-configure Evolution webhook URL on instance create"
```

The webhook URL embeds `workspace.id/instance.id` so the ingest can route the event. Plan 2's ingest uses the instance's `evolutionApiKey` from the URL path to verify the HMAC.

---

### Task 4: HMAC verification helper (TDD)

**Files:**
- New: `apps/ingest/src/hmac.ts`
- Test: `apps/ingest/src/hmac.test.ts`
- Modify: `apps/ingest/package.json` (add deps)
- Modify: `apps/ingest/tsconfig.json` (none — already strict)

We verify webhook requests by an HMAC-SHA256 over the raw body using the instance's `evolutionApiKey` as the secret. The signature arrives in a header named `x-evolution-signature`. (Evolution v2's webhook system supports custom headers; we set this in Task 3 via `headers: { 'x-evolution-signature': '<HMAC>' }` — but Evolution doesn't auto-compute HMAC. We compute it on our side as an *expected* value and compare against the incoming header.) Since Evolution itself doesn't sign, we use a different approach: the URL path includes the workspaceId + instanceId, which is itself a per-instance secret embedded in the URL. We can OPTIONALLY accept a fixed `WEBHOOK_INBOUND_SECRET` env compared against an `Authorization: Bearer <secret>` header.

Use the simpler approach: shared `WEBHOOK_INBOUND_SECRET` for now. Plan 6 will harden it.

- [ ] **Step 1: package.json adds**

`apps/ingest/package.json` — ensure dependencies include `@evo/db`, `@evo/queue`, `@evo/evolution-client`, `pino`, `ioredis`, and devDeps include `vitest` (already present). If not, add and run `pnpm install`.

Final package.json:

```json
{
  "name": "@evo/ingest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@evo/db": "workspace:*",
    "@evo/evolution-client": "workspace:*",
    "@evo/queue": "workspace:*",
    "@evo/shared": "workspace:*",
    "ioredis": "^5.4.0",
    "pino": "^9.10.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "5.7.2",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

Run `pnpm install`.

- [ ] **Step 2: Failing test for `hmac.ts`**

`apps/ingest/src/hmac.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { verifyBearer } from "./hmac";

describe("verifyBearer", () => {
  it("accepts a matching bearer", () => {
    expect(verifyBearer("Bearer abc123", "abc123")).toBe(true);
  });

  it("rejects a wrong bearer", () => {
    expect(verifyBearer("Bearer wrong", "abc123")).toBe(false);
  });

  it("rejects missing header", () => {
    expect(verifyBearer(undefined, "abc123")).toBe(false);
    expect(verifyBearer("", "abc123")).toBe(false);
  });

  it("rejects malformed bearer", () => {
    expect(verifyBearer("Basic abc123", "abc123")).toBe(false);
    expect(verifyBearer("abc123", "abc123")).toBe(false);
  });

  it("uses constant-time comparison", () => {
    // Smoke: the function must not short-circuit. We can't strictly assert timing,
    // but verifyBearer should return false on length mismatch without throwing.
    expect(verifyBearer("Bearer x", "abc123")).toBe(false);
  });
});
```

Run, verify FAIL:

```bash
pnpm --filter @evo/ingest test
```

- [ ] **Step 3: Implement `hmac.ts`**

```typescript
import { timingSafeEqual } from "node:crypto";

export function verifyBearer(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
```

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @evo/ingest test
```

Expected: 5/5 passing.

```bash
git add apps/ingest
git commit -m "feat(ingest): verifyBearer helper with constant-time comparison"
```

---

### Task 5: Evolution event normalisation (TDD)

**Files:**
- New: `apps/ingest/src/normalise.ts`
- Test: `apps/ingest/src/normalise.test.ts`

- [ ] **Step 1: Failing test**

`apps/ingest/src/normalise.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalise } from "./normalise";

describe("normalise", () => {
  it("normalises MESSAGES_UPSERT inbound text", () => {
    const event = {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-1", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "hi there" },
        messageTimestamp: 1700000000,
      },
    };
    const out = normalise(event);
    expect(out).toEqual({
      kind: "message",
      direction: "inbound",
      evolutionMessageId: "EVO-1",
      contactPhone: "60123456789",
      contactName: "Aisha",
      type: "text",
      body: "hi there",
      mediaUrl: null,
      sentAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it("normalises MESSAGES_UPSERT outbound (fromMe)", () => {
    const out = normalise({
      event: "messages.upsert",
      data: {
        key: { id: "EVO-2", remoteJid: "60123@s.whatsapp.net", fromMe: true },
        message: { conversation: "echo" },
        messageTimestamp: 1700000001,
      },
    });
    expect(out?.kind).toBe("message");
    if (out?.kind === "message") expect(out.direction).toBe("outbound");
  });

  it("normalises CONNECTION_UPDATE", () => {
    const out = normalise({
      event: "connection.update",
      data: { state: "open" },
    });
    expect(out).toEqual({ kind: "connection", state: "open" });
  });

  it("returns null for unknown events", () => {
    expect(normalise({ event: "presence.update", data: {} })).toBeNull();
    expect(normalise({})).toBeNull();
  });
});
```

Run, verify FAIL.

- [ ] **Step 2: Implement `normalise.ts`**

```typescript
export type NormalisedEvent =
  | {
      kind: "message";
      direction: "inbound" | "outbound";
      evolutionMessageId: string;
      contactPhone: string;
      contactName: string | null;
      type: string;
      body: string | null;
      mediaUrl: string | null;
      sentAt: string;
    }
  | { kind: "connection"; state: "unknown" | "connecting" | "open" | "close" }
  | { kind: "message-status"; evolutionMessageId: string; status: string };

function stripJid(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

export function normalise(raw: any): NormalisedEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const event = String(raw.event ?? "").toLowerCase();

  if (event === "messages.upsert" && raw.data?.key?.id) {
    const data = raw.data;
    const direction = data.key?.fromMe ? "outbound" : "inbound";
    const msg = data.message ?? {};
    const body = msg.conversation ?? msg.extendedTextMessage?.text ?? null;
    const ts = Number(data.messageTimestamp ?? 0) * 1000;
    return {
      kind: "message",
      direction,
      evolutionMessageId: String(data.key.id),
      contactPhone: stripJid(String(data.key.remoteJid ?? "")),
      contactName: data.pushName ?? null,
      type: "text",
      body,
      mediaUrl: null,
      sentAt: new Date(ts || Date.now()).toISOString(),
    };
  }

  if (event === "messages.update" && raw.data?.key?.id) {
    return {
      kind: "message-status",
      evolutionMessageId: String(raw.data.key.id),
      status: String(raw.data.update?.status ?? "delivered").toLowerCase(),
    };
  }

  if (event === "connection.update" && raw.data?.state) {
    const state = String(raw.data.state).toLowerCase();
    if (state === "open" || state === "close" || state === "connecting") {
      return { kind: "connection", state };
    }
    return { kind: "connection", state: "unknown" };
  }

  return null;
}
```

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @evo/ingest test
```

Expected: 9/9 passing (5 hmac + 4 normalise).

```bash
git add apps/ingest/src
git commit -m "feat(ingest): normalise Evolution events to typed union"
```

---

### Task 6: Persistence — upsert Conversation + Message (TDD, real DB)

**Files:**
- New: `apps/ingest/src/persist.ts`
- Test: `apps/ingest/src/persist.test.ts`
- New: `apps/ingest/vitest.config.ts`
- New: `apps/ingest/src/test-setup.ts`

- [ ] **Step 1: vitest config**

`apps/ingest/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
  },
});
```

`apps/ingest/src/test-setup.ts`:

```typescript
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public";
}
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = "redis://localhost:6379/15";
}
execSync("node_modules/.bin/prisma migrate deploy", {
  cwd: __dirname + "/../../../packages/db",
  stdio: "inherit",
  env: { ...process.env },
});
```

- [ ] **Step 2: Failing test**

`apps/ingest/src/persist.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { persistEvent } from "./persist";

const { prisma } = await import("@evo/db");

let workspaceId: string;
let instanceId: string;

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "t-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: {
      workspaceId: ws.id,
      label: "main",
      evolutionInstanceName: "evo-" + Date.now(),
      evolutionApiKey: "K",
    },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
});

describe("persistEvent", () => {
  it("creates a conversation + inbound message on first event", async () => {
    const result = await persistEvent({ workspaceId, instanceId }, {
      kind: "message",
      direction: "inbound",
      evolutionMessageId: "M1",
      contactPhone: "60123",
      contactName: "A",
      type: "text",
      body: "hello",
      mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    expect(result.conversation).toBeTruthy();
    expect(result.message?.body).toBe("hello");

    const convs = await prisma.conversation.findMany();
    expect(convs).toHaveLength(1);
    const msgs = await prisma.message.findMany();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.direction).toBe("inbound");
  });

  it("reuses the same conversation for subsequent messages from same contact", async () => {
    await persistEvent({ workspaceId, instanceId }, {
      kind: "message", direction: "inbound", evolutionMessageId: "M2",
      contactPhone: "60111", contactName: null, type: "text", body: "one", mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    await persistEvent({ workspaceId, instanceId }, {
      kind: "message", direction: "inbound", evolutionMessageId: "M3",
      contactPhone: "60111", contactName: null, type: "text", body: "two", mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    const convs = await prisma.conversation.findMany();
    expect(convs).toHaveLength(1);
    const msgs = await prisma.message.findMany({ orderBy: { sentAt: "asc" } });
    expect(msgs).toHaveLength(2);
  });

  it("is idempotent on duplicate evolutionMessageId", async () => {
    const evt = {
      kind: "message" as const, direction: "inbound" as const, evolutionMessageId: "DUP",
      contactPhone: "60999", contactName: null, type: "text", body: "x", mediaUrl: null,
      sentAt: new Date().toISOString(),
    };
    await persistEvent({ workspaceId, instanceId }, evt);
    await persistEvent({ workspaceId, instanceId }, evt);
    const msgs = await prisma.message.findMany();
    expect(msgs).toHaveLength(1);
  });

  it("updates instance.connectionState on connection event", async () => {
    await persistEvent({ workspaceId, instanceId }, { kind: "connection", state: "close" });
    const inst = await prisma.instance.findUnique({ where: { id: instanceId } });
    expect(inst?.connectionState).toBe("close");
  });
});
```

Run, verify FAIL.

- [ ] **Step 3: Implement `persist.ts`**

```typescript
import type { NormalisedEvent } from "./normalise";
import type { Prisma } from "@prisma/client";

export interface PersistContext {
  workspaceId: string;
  instanceId: string;
}

export async function persistEvent(
  ctx: PersistContext,
  evt: NormalisedEvent
): Promise<{ conversation?: any; message?: any }> {
  const { prisma } = await import("@evo/db");

  if (evt.kind === "connection") {
    await prisma.instance.update({
      where: { id: ctx.instanceId },
      data: { connectionState: evt.state, lastSeenAt: evt.state === "open" ? new Date() : undefined },
    });
    return {};
  }

  if (evt.kind === "message-status") {
    await prisma.message.updateMany({
      where: { evolutionMessageId: evt.evolutionMessageId, workspaceId: ctx.workspaceId },
      data: { status: mapStatus(evt.status) },
    });
    return {};
  }

  if (evt.kind === "message") {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({
        where: { evolutionMessageId: evt.evolutionMessageId },
      });
      if (existing) {
        return { message: existing };
      }
      const conversation = await tx.conversation.upsert({
        where: { instanceId_contactPhone: { instanceId: ctx.instanceId, contactPhone: evt.contactPhone } },
        create: {
          workspaceId: ctx.workspaceId,
          instanceId: ctx.instanceId,
          contactPhone: evt.contactPhone,
          contactName: evt.contactName,
          lastMessageAt: new Date(evt.sentAt),
          unreadCount: evt.direction === "inbound" ? 1 : 0,
        },
        update: {
          contactName: evt.contactName ?? undefined,
          lastMessageAt: new Date(evt.sentAt),
          unreadCount: evt.direction === "inbound" ? { increment: 1 } as any : undefined,
        },
      });
      const message = await tx.message.create({
        data: {
          workspaceId: ctx.workspaceId,
          conversationId: conversation.id,
          direction: evt.direction,
          evolutionMessageId: evt.evolutionMessageId,
          type: evt.type,
          body: evt.body,
          mediaUrl: evt.mediaUrl,
          status: "delivered",
          sentAt: new Date(evt.sentAt),
        },
      });
      return { conversation, message };
    });
  }

  return {};
}

function mapStatus(raw: string): "pending" | "sent" | "delivered" | "read" | "failed" {
  const s = raw.toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliv")) return "delivered";
  if (s.includes("sent")) return "sent";
  if (s.includes("fail") || s.includes("error")) return "failed";
  return "pending";
}
```

- [ ] **Step 4: Run and commit**

```bash
docker compose up -d postgres-manager redis-manager
pnpm --filter @evo/ingest test
```

Expected: 13/13 passing (5 hmac + 4 normalise + 4 persist).

```bash
git add apps/ingest
git commit -m "feat(ingest): persistEvent upserts conversations + messages with idempotency"
```

---

### Task 7: Redis pub/sub publisher + full ingest pipeline

**Files:**
- New: `apps/ingest/src/publish.ts`
- Modify: `apps/ingest/src/index.ts`

- [ ] **Step 1: `publish.ts`**

```typescript
import { redis } from "@evo/queue";

export async function publishEvent(workspaceId: string, payload: unknown): Promise<void> {
  const channel = `events:${workspaceId}`;
  await redis().publish(channel, JSON.stringify(payload));
}
```

- [ ] **Step 2: Wire `index.ts`**

Replace `apps/ingest/src/index.ts`:

```typescript
import http from "node:http";
import pino from "pino";
import { verifyBearer } from "./hmac.js";
import { normalise } from "./normalise.js";
import { persistEvent } from "./persist.js";
import { publishEvent } from "./publish.js";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const match = req.url?.match(/^\/whatsapp\/webhook\/([^/]+)\/([^/?]+)/);
  if (match && req.method === "POST") {
    const [, workspaceId, instanceId] = match;
    const expectedSecret = process.env.WEBHOOK_INBOUND_SECRET ?? "";
    if (expectedSecret && !verifyBearer(req.headers["authorization"] as string | undefined, expectedSecret)) {
      res.writeHead(401).end();
      return;
    }
    try {
      const buf = await readBody(req);
      const raw = buf.length ? JSON.parse(buf.toString("utf8")) : {};
      const event = normalise(raw);
      if (event) {
        const persisted = await persistEvent({ workspaceId: workspaceId!, instanceId: instanceId! }, event);
        // Enrich the published event with conversationId so the socket fan-out can route per-conversation.
        const enriched =
          event.kind === "message"
            ? { ...event, conversationId: persisted.conversation?.id, messageRowId: persisted.message?.id }
            : event;
        await publishEvent(workspaceId!, { event: enriched, instanceId });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      log.error({ err: String(err) }, "ingest failed");
      res.writeHead(500).end();
    }
    return;
  }

  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => log.info({ port }, "ingest started"));
```

- [ ] **Step 3: typecheck and commit**

```bash
pnpm --filter @evo/ingest typecheck
git add apps/ingest/src
git commit -m "feat(ingest): full webhook pipeline (verify → normalise → persist → publish)"
```

---

### Task 8: Custom Next.js server hosting Socket.IO

**Files:**
- New: `apps/web/server.ts`
- Modify: `apps/web/package.json` (start uses custom server, add socket deps)
- New: `apps/web/src/lib/socket-auth.ts`
- New: `apps/web/src/lib/socket-auth.test.ts`

- [ ] **Step 1: Package deps + scripts**

Update `apps/web/package.json`:

```json
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "next build",
    "start": "tsx server.ts",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
```

And add to dependencies:

```json
    "@socket.io/redis-adapter": "^8.3.0",
    "cookie": "^0.6.0",
    "socket.io": "^4.8.0",
    "socket.io-client": "^4.8.0"
```

devDeps:

```json
    "@types/cookie": "^0.6.0",
    "tsx": "^4.20.0"
```

Run `pnpm install`.

- [ ] **Step 2: `apps/web/server.ts` — custom server**

```typescript
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis } from "@evo/queue";
import { authoriseSocket } from "@/lib/socket-auth";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));

const pubClient = redis();
const subClient = pubClient.duplicate();

const io = new SocketIOServer(httpServer, {
  cors: { origin: false },
  adapter: createAdapter(pubClient, subClient),
});

io.use(async (socket, next) => {
  try {
    const auth = await authoriseSocket(socket.handshake.headers.cookie);
    if (!auth) return next(new Error("unauthorised"));
    (socket.data as any).userId = auth.userId;
    (socket.data as any).workspaceIds = auth.workspaceIds;
    next();
  } catch (err) {
    next(err as Error);
  }
});

io.on("connection", (socket) => {
  const data = socket.data as { userId: string; workspaceIds: string[] };
  for (const wsId of data.workspaceIds) {
    socket.join(`ws:${wsId}`);
  }

  socket.on("conv:join", (conversationId: string) => {
    socket.join(`ws:conv:${conversationId}`);
  });
  socket.on("conv:leave", (conversationId: string) => {
    socket.leave(`ws:conv:${conversationId}`);
  });
});

// Subscribe to events:* across all workspaces. Listen on a single channel pattern.
subClient.psubscribe("events:*");
subClient.on("pmessage", (_pattern, channel, message) => {
  const workspaceId = channel.replace("events:", "");
  try {
    const payload = JSON.parse(message);
    io.to(`ws:${workspaceId}`).emit("event", payload);
    if (payload?.event?.kind === "message" && payload?.event?.conversationId) {
      io.to(`ws:conv:${payload.event.conversationId}`).emit("message", payload.event);
    }
  } catch {}
});

httpServer.listen(port, () => {
  console.log(`web listening on :${port}`);
});
```

- [ ] **Step 3: `socket-auth.ts` (TDD)**

`apps/web/src/lib/socket-auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    workspaceMember: { findMany: vi.fn() },
  },
}));

const decodeMock = vi.fn();
vi.mock("@auth/core/jwt", () => ({
  decode: (...args: any[]) => decodeMock(...args),
}));

import { prisma } from "@evo/db";
import { authoriseSocket } from "./socket-auth";

const mockedFindMany = vi.mocked(prisma.workspaceMember.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
});

describe("authoriseSocket", () => {
  it("returns null when there is no cookie", async () => {
    expect(await authoriseSocket(undefined)).toBeNull();
  });

  it("returns null when the session cookie is missing/invalid", async () => {
    decodeMock.mockResolvedValue(null);
    expect(await authoriseSocket("authjs.session-token=bad")).toBeNull();
  });

  it("returns userId and workspaceIds when session decodes", async () => {
    decodeMock.mockResolvedValue({ sub: "u-1" });
    mockedFindMany.mockResolvedValue([{ workspaceId: "w-1" } as any, { workspaceId: "w-2" } as any]);
    const result = await authoriseSocket("authjs.session-token=valid");
    expect(result).toEqual({ userId: "u-1", workspaceIds: ["w-1", "w-2"] });
  });
});
```

`apps/web/src/lib/socket-auth.ts`:

```typescript
import { parse as parseCookie } from "cookie";
import { decode } from "@auth/core/jwt";
import { prisma } from "@evo/db";

const COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token", "next-auth.session-token"];

export async function authoriseSocket(cookieHeader: string | undefined): Promise<{ userId: string; workspaceIds: string[] } | null> {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const token = COOKIE_NAMES.map((n) => cookies[n]).find(Boolean);
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const payload = await decode({ token, secret, salt: "authjs.session-token" });
    if (!payload?.sub) return null;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: payload.sub },
      select: { workspaceId: true },
    });
    return { userId: payload.sub, workspaceIds: memberships.map((m) => m.workspaceId) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @evo/web test
```

Expected: 18/18 passing (15 from Plan 1 + 3 socket-auth).

```bash
pnpm --filter @evo/web typecheck
git add apps/web/package.json apps/web/server.ts apps/web/src/lib/socket-auth.ts apps/web/src/lib/socket-auth.test.ts pnpm-lock.yaml
git commit -m "feat(web): custom server hosting Socket.IO with Auth.js cookie auth"
```

---

### Task 9: Client-side Socket.IO singleton + connection hook

**Files:**
- New: `apps/web/src/lib/socket.ts`

- [ ] **Step 1: Implement**

```typescript
"use client";
import { io as createSocket, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = createSocket({
    path: "/socket.io",
    autoConnect: true,
    withCredentials: true,
  });
  return socket;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/socket.ts
git commit -m "feat(web): client-side Socket.IO singleton"
```

---

### Task 10: Conversations API

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/route.ts` (GET list)
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/[id]/route.ts` (GET detail)
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/[id]/messages/route.ts` (GET history + POST reply)
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/[id]/assign/route.ts` (POST assign)
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/[id]/status/route.ts` (POST status)
- New: `apps/web/src/app/api/workspaces/[slug]/conversations/[id]/notes/route.ts` (GET/POST notes)

- [ ] **Step 1: GET list — `conversations/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "all";
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const where: any = {};
    if (filter === "mine") where.assignedToUserId = userId;
    if (filter === "unassigned") where.assignedToUserId = null;
    if (filter === "open") where.status = "open";
    const conversations = await db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ conversations });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: GET detail — `[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    return NextResponse.json({ conversation: conv });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: GET messages + POST reply — `[id]/messages/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance } from "@/lib/send";
import { AppError, NotFoundError } from "@evo/shared";

const replySchema = z.object({ text: z.string().min(1).max(4000) });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    const messages = await db.message.findMany({
      where: { conversationId: id },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ messages: messages.reverse() });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const parsed = replySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });

    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");

    // Optimistic outbound row, no evolutionMessageId yet; reconciled on SEND_MESSAGE event.
    const message = await db.message.create({
      data: {
        conversationId: id,
        direction: "outbound",
        type: "text",
        body: parsed.data.text,
        status: "pending",
        sentByUserId: userId,
      } as any,
    });

    try {
      await sendViaInstance(conv.instanceId, {
        type: "text",
        to: conv.contactPhone,
        text: parsed.data.text,
        userId,
      });
      await prisma.message.update({ where: { id: message.id }, data: { status: "sent" } });
    } catch (err: any) {
      await prisma.message.update({ where: { id: message.id }, data: { status: "failed" } });
      if (String(err?.message ?? "").startsWith("throttled")) {
        return NextResponse.json({ error: "THROTTLED" }, { status: 429 });
      }
      return NextResponse.json({ error: "SEND_FAILED" }, { status: 502 });
    }

    await db.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date(), unreadCount: 0 },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: POST assign — `[id]/assign/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const bodySchema = z.object({ userId: z.string().nullable() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId: actorId } = await requireMember(slug, "Agent");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");

    await db.conversation.update({ where: { id }, data: { assignedToUserId: parsed.data.userId } });
    if (parsed.data.userId) {
      await db.assignment.create({ data: { conversationId: id, userId: parsed.data.userId } as any });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 5: POST status — `[id]/status/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const bodySchema = z.object({ status: z.enum(["open", "pending", "resolved"]) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    await db.conversation.update({ where: { id }, data: { status: parsed.data.status } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 6: GET/POST notes — `[id]/notes/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const noteSchema = z.object({ body: z.string().min(1).max(2000) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const notes = await db.internalNote.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ notes });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const parsed = noteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    const note = await db.internalNote.create({
      data: { conversationId: id, userId, body: parsed.data.body } as any,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 7: typecheck and commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/conversations"
git commit -m "feat(web): conversations API (list, detail, messages, assign, status, notes)"
```

---

### Task 11: Quick replies CRUD

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/quick-replies/route.ts` (GET list, POST create)
- New: `apps/web/src/app/api/workspaces/[slug]/quick-replies/[id]/route.ts` (PUT, DELETE)
- New: `apps/web/src/app/[workspaceSlug]/settings/quick-replies/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/settings/quick-replies/quick-replies-form.tsx`

- [ ] **Step 1: API list/create — `quick-replies/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const schema = z.object({ shortcut: z.string().min(1).max(40), body: z.string().min(1).max(2000) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const items = await db.quickReply.findMany({ orderBy: { shortcut: "asc" } });
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const item = await db.quickReply.create({ data: parsed.data as any });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: PUT/DELETE — `[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({ shortcut: z.string().min(1).max(40).optional(), body: z.string().min(1).max(2000).optional() });

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.quickReply.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Quick reply not found");
    const item = await db.quickReply.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.quickReply.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Quick reply not found");
    await db.quickReply.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: UI page — `settings/quick-replies/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import QuickRepliesForm from "./quick-replies-form";

export default async function QuickRepliesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const items = await db.quickReply.findMany({ orderBy: { shortcut: "asc" } });
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("quickReplies.title")}</h1>
      <QuickRepliesForm workspaceSlug={workspaceSlug} initialItems={items.map(i => ({ id: i.id, shortcut: i.shortcut, body: i.body }))} />
    </div>
  );
}
```

- [ ] **Step 4: Client form — `quick-replies-form.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Item = { id: string; shortcut: string; body: string };

export default function QuickRepliesForm({ workspaceSlug, initialItems }: { workspaceSlug: string; initialItems: Item[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/quick-replies`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcut, body }),
    });
    setBusy(false);
    if (res.ok) {
      const { item } = await res.json();
      setItems((x) => [...x, item]);
      setShortcut("");
      setBody("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (!confirm(t("quickReplies.confirmDelete"))) return;
    await fetch(`/api/workspaces/${workspaceSlug}/quick-replies/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2 border rounded p-3">
        <input className="w-full border rounded p-2" placeholder={t("quickReplies.shortcut")} value={shortcut} onChange={(e) => setShortcut(e.target.value)} required maxLength={40} />
        <textarea className="w-full border rounded p-2" placeholder={t("quickReplies.body")} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} rows={3} />
        <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("quickReplies.add")}</button>
      </form>
      <ul className="border rounded divide-y">
        {items.map((it) => (
          <li key={it.id} className="p-3 flex justify-between gap-3">
            <div>
              <div><strong>{it.shortcut}</strong></div>
              <div className="text-sm text-gray-600 whitespace-pre-wrap">{it.body}</div>
            </div>
            <button onClick={() => remove(it.id)} className="text-red-600 text-sm underline">{t("common.delete")}</button>
          </li>
        ))}
        {items.length === 0 && <li className="p-3 text-gray-500 text-sm">—</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: i18n keys**

Add to `apps/web/messages/en-GB.json`:

```json
  "quickReplies": {
    "title": "Quick replies",
    "shortcut": "Shortcut (e.g. /hi)",
    "body": "Message body",
    "add": "Add",
    "confirmDelete": "Delete this quick reply?"
  },
```

- [ ] **Step 6: typecheck and commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/quick-replies" "apps/web/src/app/[workspaceSlug]/settings/quick-replies" apps/web/messages/en-GB.json
git commit -m "feat(web): quick replies CRUD + settings page"
```

---

### Task 12: Inbox UI — list + chat pane + reply box + sidebar

**Files:**
- New: `apps/web/src/app/[workspaceSlug]/inbox/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/inbox/conversation-list.tsx`
- New: `apps/web/src/app/[workspaceSlug]/inbox/[conversationId]/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/inbox/[conversationId]/chat-pane.tsx`
- New: `apps/web/src/app/[workspaceSlug]/inbox/[conversationId]/reply-box.tsx`
- New: `apps/web/src/app/[workspaceSlug]/inbox/[conversationId]/sidebar.tsx`
- Modify: `apps/web/messages/en-GB.json` (inbox.*, notes.*)
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx` (add Inbox nav link)

- [ ] **Step 1: Add i18n keys** to `en-GB.json`:

```json
  "nav": {
    "dashboard": "Dashboard",
    "inbox": "Inbox",
    "instances": "Instances",
    "members": "Members"
  },
  "inbox": {
    "title": "Inbox",
    "filterAll": "All",
    "filterMine": "Mine",
    "filterUnassigned": "Unassigned",
    "filterOpen": "Open",
    "emptyList": "No conversations",
    "emptyChat": "Pick a conversation",
    "replyPlaceholder": "Type a message",
    "send": "Send",
    "statusOpen": "Open",
    "statusPending": "Pending",
    "statusResolved": "Resolved",
    "changeStatus": "Status",
    "assignTo": "Assign to",
    "unassigned": "(unassigned)",
    "notesHeading": "Internal notes",
    "addNote": "Add note",
    "notePlaceholder": "Internal note (only your team sees this)"
  },
```

- [ ] **Step 2: Inbox layout (list pane) — `inbox/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import ConversationList from "./conversation-list";

export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Agent");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const conversations = await db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-0">
      <ConversationList
        workspaceSlug={workspaceSlug}
        initial={conversations.map((c) => ({
          id: c.id, contactPhone: c.contactPhone, contactName: c.contactName,
          lastMessageAt: c.lastMessageAt.toISOString(), unreadCount: c.unreadCount,
          status: c.status,
        }))}
      />
      <main className="flex-1 flex items-center justify-center text-gray-400">
        {t("inbox.emptyChat")}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: `conversation-list.tsx` (client, subscribes to socket)**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getSocket } from "@/lib/socket";

type Conv = { id: string; contactPhone: string; contactName: string | null; lastMessageAt: string; unreadCount: number; status: string };

export default function ConversationList({ workspaceSlug, initial }: { workspaceSlug: string; initial: Conv[] }) {
  const t = useTranslations();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned" | "open">("all");

  useEffect(() => {
    const s = getSocket();
    function onEvent(payload: any) {
      if (payload?.event?.kind === "message" && payload?.event?.conversationId) {
        setItems((curr) => {
          const idx = curr.findIndex((c) => c.id === payload.event.conversationId);
          if (idx === -1) return curr;
          const next = [...curr];
          const updated = { ...next[idx]!, lastMessageAt: payload.event.sentAt, unreadCount: next[idx]!.unreadCount + (payload.event.direction === "inbound" ? 1 : 0) };
          next.splice(idx, 1);
          return [updated, ...next];
        });
      }
    }
    s.on("event", onEvent);
    return () => { s.off("event", onEvent); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "open") return items.filter((i) => i.status === "open");
    return items;
  }, [items, filter]);

  return (
    <aside className="w-80 border-r overflow-y-auto">
      <div className="p-3 border-b">
        <h1 className="text-lg font-semibold mb-2">{t("inbox.title")}</h1>
        <div className="flex gap-1 text-xs">
          {(["all", "mine", "unassigned", "open"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2 py-1 rounded ${filter === f ? "bg-black text-white" : "bg-gray-100"}`}>
              {t(`inbox.filter${f[0]!.toUpperCase() + f.slice(1)}` as any)}
            </button>
          ))}
        </div>
      </div>
      <ul>
        {filtered.map((c) => (
          <li key={c.id} className="border-b">
            <Link href={`/${workspaceSlug}/inbox/${c.id}`} className="block p-3 hover:bg-gray-50">
              <div className="flex justify-between">
                <strong>{c.contactName ?? c.contactPhone}</strong>
                {c.unreadCount > 0 && <span className="text-xs bg-black text-white rounded-full px-2 py-0.5">{c.unreadCount}</span>}
              </div>
              <div className="text-xs text-gray-500">{new Date(c.lastMessageAt).toLocaleString("en-GB")}</div>
            </Link>
          </li>
        ))}
        {filtered.length === 0 && <li className="p-4 text-gray-400 text-sm">{t("inbox.emptyList")}</li>}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 4: Chat pane shell — `inbox/[conversationId]/page.tsx`**

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import ChatPane from "./chat-pane";
import Sidebar from "./sidebar";

export default async function ConversationPage({
  params,
}: { params: Promise<{ workspaceSlug: string; conversationId: string }> }) {
  const { workspaceSlug, conversationId } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Agent");
  const db = tenantClient(workspace.id);
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) notFound();
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  // mark as read
  await db.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });

  return (
    <div className="flex h-[calc(100vh-2rem)]">
      <ChatPane
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        contactLabel={conv.contactName ?? conv.contactPhone}
        initialMessages={messages.reverse().map((m) => ({
          id: m.id, direction: m.direction, body: m.body, sentAt: m.sentAt.toISOString(), status: m.status,
        }))}
      />
      <Sidebar
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        currentStatus={conv.status}
        assignedToUserId={conv.assignedToUserId}
      />
    </div>
  );
}
```

- [ ] **Step 5: `chat-pane.tsx` (client, subscribes to per-conversation room)**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import ReplyBox from "./reply-box";

type Msg = { id: string; direction: "inbound" | "outbound"; body: string | null; sentAt: string; status: string };

export default function ChatPane({
  workspaceSlug, conversationId, contactLabel, initialMessages,
}: {
  workspaceSlug: string; conversationId: string; contactLabel: string; initialMessages: Msg[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = getSocket();
    s.emit("conv:join", conversationId);
    function onMsg(m: any) {
      if (!m?.evolutionMessageId) return;
      setMessages((curr) => {
        if (curr.some((x) => x.id === m.evolutionMessageId)) return curr;
        return [...curr, { id: m.evolutionMessageId, direction: m.direction, body: m.body, sentAt: m.sentAt, status: "delivered" }];
      });
    }
    s.on("message", onMsg);
    return () => { s.emit("conv:leave", conversationId); s.off("message", onMsg); };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  function onLocalAppend(m: Msg) {
    setMessages((curr) => [...curr, m]);
  }

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b p-3 font-semibold">{contactLabel}</header>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[70%] px-3 py-2 rounded ${m.direction === "outbound" ? "bg-black text-white ml-auto" : "bg-white border"}`}>
            <div className="text-sm whitespace-pre-wrap">{m.body ?? ""}</div>
            <div className="text-[10px] opacity-60 mt-1">{new Date(m.sentAt).toLocaleTimeString("en-GB")} · {m.status}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <ReplyBox workspaceSlug={workspaceSlug} conversationId={conversationId} onSent={onLocalAppend} />
    </main>
  );
}
```

- [ ] **Step 6: `reply-box.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Msg = { id: string; direction: "inbound" | "outbound"; body: string | null; sentAt: string; status: string };

export default function ReplyBox({
  workspaceSlug, conversationId, onSent,
}: { workspaceSlug: string; conversationId: string; onSent: (m: Msg) => void }) {
  const t = useTranslations();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [quickReplies, setQuickReplies] = useState<{ shortcut: string; body: string }[]>([]);

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/quick-replies`).then(async (r) => {
      if (r.ok) {
        const { items } = await r.json();
        setQuickReplies(items.map((i: any) => ({ shortcut: i.shortcut, body: i.body })));
      }
    });
  }, [workspaceSlug]);

  function maybeExpandShortcut(value: string) {
    setText(value);
    const match = quickReplies.find((q) => q.shortcut === value.trim());
    if (match) setText(match.body);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    setBusy(false);
    if (res.ok) {
      const { message } = await res.json();
      onSent({ id: message.id, direction: "outbound", body: text, sentAt: new Date().toISOString(), status: "sent" });
      setText("");
    } else if (res.status === 429) {
      alert(t("instances.throttled"));
    } else {
      alert(t("instances.sentFailed"));
    }
  }

  return (
    <form onSubmit={send} className="border-t p-3 flex gap-2">
      <input
        className="flex-1 border rounded p-2"
        value={text}
        onChange={(e) => maybeExpandShortcut(e.target.value)}
        placeholder={t("inbox.replyPlaceholder")}
        required
      />
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("inbox.send")}</button>
    </form>
  );
}
```

- [ ] **Step 7: `sidebar.tsx`** (assign + status + notes)

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Note = { id: string; body: string; createdAt: string; userId: string };

export default function Sidebar({
  workspaceSlug, conversationId, currentStatus, assignedToUserId,
}: {
  workspaceSlug: string; conversationId: string; currentStatus: string; assignedToUserId: string | null;
}) {
  const t = useTranslations();
  const [status, setStatus] = useState(currentStatus);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [assignee, setAssignee] = useState<string | null>(assignedToUserId);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/members`).then(async (r) => {
      if (r.ok) {
        const { members } = await r.json();
        setMembers(members.map((m: any) => ({ userId: m.userId, name: m.user?.name ?? m.userId })));
      }
    });
    fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/notes`).then(async (r) => {
      if (r.ok) {
        const { notes } = await r.json();
        setNotes(notes);
      }
    });
  }, [workspaceSlug, conversationId]);

  async function updateStatus(s: string) {
    setStatus(s);
    await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/status`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s }),
    });
  }
  async function assign(userId: string | null) {
    setAssignee(userId);
    await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/assign`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }),
    });
  }
  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: noteText }),
    });
    if (res.ok) {
      const { note } = await res.json();
      setNotes((n) => [...n, note]);
      setNoteText("");
    }
  }

  return (
    <aside className="w-72 border-l p-4 space-y-4 overflow-y-auto">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t("inbox.changeStatus")}</label>
        <select className="w-full border rounded p-2" value={status} onChange={(e) => updateStatus(e.target.value)}>
          <option value="open">{t("inbox.statusOpen")}</option>
          <option value="pending">{t("inbox.statusPending")}</option>
          <option value="resolved">{t("inbox.statusResolved")}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t("inbox.assignTo")}</label>
        <select className="w-full border rounded p-2" value={assignee ?? ""} onChange={(e) => assign(e.target.value || null)}>
          <option value="">{t("inbox.unassigned")}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </select>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">{t("inbox.notesHeading")}</h3>
        <ul className="space-y-2 mb-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm bg-yellow-50 p-2 rounded">{n.body}</li>
          ))}
        </ul>
        <form onSubmit={addNote} className="space-y-2">
          <textarea className="w-full border rounded p-2 text-sm" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("inbox.notePlaceholder")} rows={3} required />
          <button className="text-sm bg-black text-white rounded p-1 px-3">{t("inbox.addNote")}</button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 8: Members API (needed by sidebar)** — add `apps/web/src/app/api/workspaces/[slug]/members/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const members = await db.workspaceMember.findMany({ include: { user: { select: { name: true, email: true } } } });
    return NextResponse.json({ members });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 9: Nav link for Inbox**

In `apps/web/src/app/[workspaceSlug]/layout.tsx`, add Inbox link before Instances:

```tsx
        <Link href={`/${workspaceSlug}/inbox`} className="block">{t("nav.inbox")}</Link>
```

- [ ] **Step 10: typecheck and commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/inbox" "apps/web/src/app/[workspaceSlug]/layout.tsx" "apps/web/src/app/api/workspaces/[slug]/members/route.ts" apps/web/messages/en-GB.json
git commit -m "feat(web): three-pane inbox with assignments, notes, quick replies"
```

---

### Task 13: Dockerfile update for custom server + nav e2e

**Files:**
- Modify: `apps/web/Dockerfile`
- New: `tests/e2e/inbox-roundtrip.spec.ts`

- [ ] **Step 1: Dockerfile**

The web container's CMD currently calls `pnpm start` which now runs `tsx server.ts`. tsx needs to be available at runtime. Update `apps/web/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/web build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=base /app /app
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
```

(Identical to Plan 0's, but explicitly noted since the start script now invokes `tsx`. tsx is in apps/web's devDependencies; we don't strip dev deps in the base layer.)

- [ ] **Step 2: E2E roundtrip — `inbox-roundtrip.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18081;
const INGEST_BASE = "http://localhost:4000"; // requires ingest running; if not, dev-time skip

test.beforeAll(async () => {
  resetDb();
  // Minimal Evolution stub — same patterns as plan 1 spec
  stub = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub" }, hash: "stub-key", qrcode: { base64: "data:image/png;base64,iVBORw0KGgo=" } }));
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub", state: "open" } })); return;
    }
    if (req.url?.startsWith("/webhook/set/")) {
      res.writeHead(200); res.end(JSON.stringify({ webhook: { enabled: true } })); return;
    }
    if (req.url?.startsWith("/message/sendText/")) {
      res.writeHead(200); res.end(JSON.stringify({ key: { id: "EVO-REPLY" }, status: "PENDING" })); return;
    }
    if (req.url?.startsWith("/chat/sendPresence/")) {
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => stub.listen(STUB_PORT, r));
});

test.afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});

test("inbound webhook surfaces in inbox; reply sends through chokepoint", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // sign up + workspace
  const email = freshEmail("inbox");
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Inbox Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // create an instance (auto-configures stub webhook)
  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Inbox WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);
  const instanceId = page.url().match(/instances\/([^/]+)\/pair/)![1];

  // get workspace.id from a DB read via the API (simpler: navigate to dashboard which embeds slug, ask via /api/workspaces? — skip and read from the instance detail which only exposes the local instance id, not workspace id; use the slug for the webhook path)
  // The ingest expects path /whatsapp/webhook/{workspaceId}/{instanceId}. Slug != workspaceId. We POST against the ingest using slug fallback impossible.
  // Workaround: fetch the dashboard's /api/workspaces/<slug>/instances/<id> and read workspaceId from the response.
  const resp = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances/${instanceId}`, {
    headers: { cookie: await ctx.cookies().then((cs) => cs.map((c) => `${c.name}=${c.value}`).join("; ")) },
  });
  const { instance } = await resp.json();
  const workspaceId = instance.workspaceId;

  // POST a synthetic Evolution event directly to the ingest
  const webhookRes = await request.post(`${INGEST_BASE}/whatsapp/webhook/${workspaceId}/${instanceId}`, {
    data: {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-INBOUND-1", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "hello from outside" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });
  expect(webhookRes.ok()).toBe(true);

  // open the inbox and see the conversation appear
  await page.goto(`/${slug}/inbox`);
  await expect(page.getByText("Aisha")).toBeVisible({ timeout: 10000 });
  await page.getByText("Aisha").click();
  await expect(page.getByText("hello from outside")).toBeVisible({ timeout: 5000 });

  // reply
  await page.getByPlaceholder("Type a message").fill("hi back");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText("hi back")).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 3: Run (requires `apps/ingest` to be running locally)**

```bash
docker compose up -d postgres-manager redis-manager
pnpm --filter @evo/db exec prisma migrate deploy
# Start the ingest in the background:
PORT=4000 pnpm --filter @evo/ingest dev > /tmp/ingest.log 2>&1 &
INGEST_PID=$!
sleep 4
# Start the web in dev (with custom server); Playwright's webServer reuses if present.
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
pnpm --filter @evo/web test:e2e -- inbox-roundtrip.spec.ts
kill $INGEST_PID 2>/dev/null
```

If port 3000 is busy and you can't kill, use `E2E_BASE_URL` to point at a manually-started server on a free port.

Expected: 1 PASS (plus the two existing e2e specs may also run depending on config — that's fine, all should pass).

- [ ] **Step 4: Commit**

```bash
git add apps/web/Dockerfile tests/e2e/inbox-roundtrip.spec.ts
git commit -m "test(e2e): inbox roundtrip — webhook in → inbox visible → reply out"
```

---

### Task 14: Plan 2 final review pass

**Files:** none — verification only.

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm -r test
```

Expected totals:
- `@evo/shared` 8
- `@evo/db` 3
- `@evo/queue` 4
- `@evo/evolution-client` 12
- `@evo/ingest` 13
- `@evo/web` 18+
- 3 e2e specs all passing

- [ ] **Step 2: Manual smoke** (optional, only with a real WhatsApp number)

`docker compose up -d` → open `http://localhost:3000` → pair an instance with a real WhatsApp → send yourself a message from another phone → see it appear in the inbox → reply → see it arrive on the other phone.

- [ ] **Step 3: No commit needed — Plan 2 done.**

---

## Plan 2 verification checklist

After Task 14:

- [ ] Schema migration `<14-digit>_inbox/` exists with the 5 new tables.
- [ ] Webhook auto-config fires on instance create (stub e2e verifies).
- [ ] Ingest pipeline: HMAC bearer check (when secret set), normalise → persist → publish.
- [ ] Custom Next.js server runs with Socket.IO + Redis adapter.
- [ ] Auth.js session cookie authenticates the Socket.IO handshake.
- [ ] Inbox list updates in real time when a message arrives.
- [ ] Chat pane appends messages in real time.
- [ ] Reply box routes through `sendViaInstance` chokepoint.
- [ ] Assignment, status, internal notes all wired and tenant-scoped.
- [ ] Quick replies CRUD works and the reply box expands them inline.
- [ ] `pnpm typecheck` and `pnpm -r test` pass; new e2e roundtrip passes.

When all checked: Plan 2 done. Next is **Plan 3 — Contacts + broadcasts** (contacts CRUD, CSV import, number validator, broadcast wizard + queues + jitter).
