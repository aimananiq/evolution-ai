# Plan 6.6 — Deferred Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the integration scaffolding that Plan 6.5 left as scope cuts: developer API auth middleware (verify `ek_…` tokens on `/api/v1/*`), outbound webhook delivery worker (sign + POST events to subscriber URLs with retry), and Typebot pass-through configurator (proves the Chatwoot pattern generalises). Real billing is out of scope here (separate spec).

**Architecture:** A new `/api/v1/*` route surface authenticated by developer API key (no session). The middleware validates the bearer token by argon2-verifying against the `ApiKey.hashedKey` and attaches the workspace + key id to a request context. The webhook delivery worker subscribes to a new `webhook` BullMQ queue; producers in `apps/ingest` (on message events) and `apps/worker` (on broadcast events) enqueue `{ subscriptionId, event, payload }` jobs. The worker POSTs the payload with an `X-Webhook-Signature: sha256=<hmac>` header, retries with exponential backoff, and records `WebhookDelivery` rows. Typebot follows the same shape as Chatwoot but persists its token encrypted via `@evo/crypto`.

**Tech Stack:** existing argon2, BullMQ, node:crypto HMAC, `@evo/crypto`, `@evo/evolution-client` (new `TypebotApi`), Prisma.

---

## File Structure

**Schema:**
- Modify `packages/db/prisma/schema.prisma` — add `WebhookDelivery` model.
- `packages/db/src/tenant.ts` — add `"WebhookDelivery"`.

**Auth middleware:**
- `apps/web/src/lib/api-auth.ts` — `verifyApiKey(req): Promise<{ workspaceId; apiKeyId } | null>`.
- `apps/web/src/app/api/v1/_helpers.ts` — wraps a handler with auth.

**v1 endpoints (first slice):**
- `apps/web/src/app/api/v1/send/route.ts` — POST send text via instance.
- `apps/web/src/app/api/v1/conversations/route.ts` — GET list.

**Webhook producer + delivery:**
- `packages/queue/src/index.ts` — register `webhook` queue.
- `apps/ingest/src/webhook-emit.ts` — `emitEvent(workspaceId, event, payload)` enqueues to subscribers.
- `apps/worker/src/webhook-delivery.ts` — processor: POST + retry + record.
- Modify `apps/ingest/src/persist.ts` (or whichever file finalises inbound/outbound) to call `emitEvent` on `message.received` / `message.sent` / `message.status`.
- Modify `apps/worker/src/index.ts` to call `emitEvent` on broadcast completion/failure and instance state changes.

**Typebot:**
- `packages/evolution-client/src/typebot.ts` + `typebot.test.ts`.
- `apps/web/src/app/api/workspaces/[slug]/integrations/typebot/route.ts`.
- `apps/web/src/app/[workspaceSlug]/settings/integrations/typebot/page.tsx` + `typebot-form.tsx`.
- Hub page update to include Typebot link.

---

## Task 1: WebhookDelivery schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`

- [ ] **Step 1: Model**

```prisma
model WebhookDelivery {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  subscriptionId  String
  subscription    WebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  event           String
  payload         Json
  attempts        Int      @default(0)
  status          WebhookDeliveryStatus @default(pending)
  responseStatus  Int?
  responseBody    String?
  lastAttemptAt   DateTime?
  createdAt       DateTime @default(now())
  @@index([workspaceId, subscriptionId, status])
  @@index([status, createdAt])
}

enum WebhookDeliveryStatus {
  pending
  succeeded
  failed
  dead
}
```

Add back-relation on `WebhookSubscription`: `deliveries WebhookDelivery[]`.

- [ ] **Step 2: tenancy + migration + commit**

```bash
pnpm --filter @evo/db prisma:migrate --name webhook_delivery
git add packages/db
git commit -m "feat(db): WebhookDelivery model + status enum"
```

---

## Task 2: API key auth middleware

**Files:**
- Create: `apps/web/src/lib/api-auth.ts`
- Create: `apps/web/src/lib/api-auth.test.ts`

- [ ] **Step 1: Implementation**

```typescript
import argon2 from "argon2";
import { prisma } from "@evo/db";

export interface ApiAuthResult { workspaceId: string; apiKeyId: string; }

export async function verifyApiKey(req: Request): Promise<ApiAuthResult | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith("ek_") || token.length < 20) return null;
  const candidates = await prisma.apiKey.findMany({
    where: { revokedAt: null, prefix: token.slice(0, 6) }, // we'll add prefix column below
    select: { id: true, hashedKey: true, workspaceId: true },
  });
  for (const row of candidates) {
    try {
      if (await argon2.verify(row.hashedKey, token)) {
        await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
        return { workspaceId: row.workspaceId, apiKeyId: row.id };
      }
    } catch {}
  }
  return null;
}
```

Add a `prefix String` column to `ApiKey` (e.g. `ek_AB12`) and have the existing key-create route populate it. That keeps lookup O(1)-ish instead of scanning the whole table.

- [ ] **Step 2: Schema migration for the prefix column**

```bash
# Edit schema.prisma to add: prefix String? // first 7 chars of the issued token, for fast lookup
pnpm --filter @evo/db prisma:migrate --name api_key_prefix
```

Modify the existing api-keys POST handler (`apps/web/src/app/api/workspaces/[slug]/api-keys/route.ts`) to set `prefix: token.slice(0, 7)` on create.

(Optional backfill script for existing rows — can be skipped if no existing rows in dev.)

- [ ] **Step 3: Test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyApiKey } from "./api-auth";

vi.mock("@evo/db", () => ({
  prisma: {
    apiKey: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("verifyApiKey", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns null without authorization header", async () => {
    expect(await verifyApiKey(new Request("http://x"))).toBeNull();
  });
  it("returns null for non-ek_ token", async () => {
    const req = new Request("http://x", { headers: { authorization: "Bearer xx" } });
    expect(await verifyApiKey(req)).toBeNull();
  });
  // The argon2 success path is exercised in an integration test against a real DB.
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api-auth.ts apps/web/src/lib/api-auth.test.ts packages/db
git commit -m "feat(web,db): ApiKey prefix column + verifyApiKey middleware helper"
```

---

## Task 3: First /api/v1 endpoints

**Files:**
- Create: `apps/web/src/app/api/v1/_helpers.ts`
- Create: `apps/web/src/app/api/v1/send/route.ts`
- Create: `apps/web/src/app/api/v1/conversations/route.ts`

- [ ] **Step 1: helpers**

```typescript
import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-auth";

export async function withApiAuth<T>(req: Request, handler: (ctx: { workspaceId: string; apiKeyId: string }) => Promise<T>) {
  const auth = await verifyApiKey(req);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return handler(auth);
}
```

- [ ] **Step 2: send endpoint**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth } from "../_helpers";
import { tenantClient } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const schema = z.object({
  instanceId: z.string(),
  to: z.string().min(8),
  text: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  return withApiAuth(req, async ({ workspaceId }) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspaceId);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 404 });
    const result = await sendViaInstance({ workspaceId, instanceId: instance.id, to: parsed.data.to, text: parsed.data.text });
    return NextResponse.json({ ok: true, messageId: result?.messageId ?? null }, { status: 201 });
  });
}
```

- [ ] **Step 3: conversations list**

```typescript
import { NextResponse } from "next/server";
import { withApiAuth } from "../_helpers";
import { tenantClient } from "@evo/db";

export async function GET(req: Request) {
  return withApiAuth(req, async ({ workspaceId }) => {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const db = tenantClient(workspaceId);
    const conversations = await db.conversation.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: { id: true, contactJid: true, lastMessageAt: true, lastMessageText: true, unreadCount: true },
    });
    return NextResponse.json({ conversations });
  });
}
```

- [ ] **Step 4: Integration test (real DB)**

`apps/web/src/app/api/v1/send.integration.test.ts`:
- Create workspace, instance, api key.
- POST to /api/v1/send with the bearer token.
- Assert 201 and that an outbound message row was created.

(Use the same test harness as other integration tests in the repo.)

- [ ] **Step 5: commit**

```bash
git add apps/web/src/app/api/v1
git commit -m "feat(web): /api/v1/send + /api/v1/conversations authenticated by developer API key"
```

---

## Task 4: Webhook delivery worker

**Files:**
- Modify: `packages/queue/src/index.ts` — register `webhook` queue.
- Create: `apps/ingest/src/webhook-emit.ts`
- Create: `apps/worker/src/webhook-delivery.ts`
- Modify: `apps/worker/src/index.ts` to register the processor.

- [ ] **Step 1: Queue registration**

In `packages/queue/src/index.ts`, add a `webhookQueue` matching the pattern of the existing queues.

- [ ] **Step 2: emitEvent**

```typescript
// apps/ingest/src/webhook-emit.ts
import { prisma } from "@evo/db";
import { webhookQueue } from "@evo/queue";

export async function emitEvent(workspaceId: string, event: string, payload: unknown) {
  const subs = await prisma.webhookSubscription.findMany({
    where: { workspaceId, enabled: true },
    select: { id: true, events: true },
  });
  for (const sub of subs) {
    const events = sub.events as string[];
    if (!events.includes(event)) continue;
    const delivery = await prisma.webhookDelivery.create({
      data: { workspaceId, subscriptionId: sub.id, event, payload: payload as any },
      select: { id: true },
    });
    await webhookQueue.add("deliver", { deliveryId: delivery.id }, {
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
    });
  }
}
```

- [ ] **Step 3: Delivery processor**

```typescript
// apps/worker/src/webhook-delivery.ts
import { createHmac } from "node:crypto";
import { prisma } from "@evo/db";

export async function processWebhookDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { subscription: true },
  });
  if (!delivery) return;
  if (delivery.status !== "pending") return;
  if (!delivery.subscription.enabled) {
    await prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "dead", responseBody: "subscription disabled" } });
    return;
  }
  const body = JSON.stringify({ event: delivery.event, data: delivery.payload, timestamp: new Date().toISOString(), subscriptionId: delivery.subscriptionId });
  const signature = createHmac("sha256", delivery.subscription.secret).update(body).digest("hex");
  let responseStatus = 0;
  let responseBody = "";
  try {
    const res = await fetch(delivery.subscription.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-event": delivery.event,
        "x-webhook-delivery": delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, 2_000);
    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: "succeeded", attempts: { increment: 1 }, responseStatus, responseBody, lastAttemptAt: new Date() },
      });
      return;
    }
    throw new Error(`upstream ${res.status}`);
  } catch (e: any) {
    const updated = await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: 1 },
        responseStatus,
        responseBody: responseBody || String(e?.message ?? e),
        lastAttemptAt: new Date(),
      },
      select: { attempts: true },
    });
    if (updated.attempts >= 5) {
      await prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "dead" } });
      return;
    }
    throw e; // re-throw so BullMQ retries with backoff
  }
}
```

- [ ] **Step 4: Register the processor in worker index**

```typescript
import { Worker } from "bullmq";
import { processWebhookDelivery } from "./webhook-delivery";
// in the same module that creates other workers:
const webhookWorker = new Worker("webhook", async (job) => {
  if (job.name === "deliver") await processWebhookDelivery(job.data.deliveryId);
}, { connection });
```

- [ ] **Step 5: Wire emitEvent into producers**

Search for the existing ingest finalisation points:
- After persistEvent finalises an inbound message → `emitEvent(workspaceId, "message.received", { conversationId, messageId, from, text })`.
- After sendViaInstance returns OK in the web wrapper → `emitEvent(workspaceId, "message.sent", { instanceId, to, messageId })`.
- After a status webhook for outbound delivery → `emitEvent(workspaceId, "message.status", { messageId, status })`.
- Instance state transitions in the worker tick → `emitEvent(workspaceId, "instance.state", { instanceId, state })`.
- Broadcast finalisation paths in the worker → `emitEvent(workspaceId, "broadcast.completed" | "broadcast.failed", { broadcastId, sent, failed })`.

Add the imports + calls; no other logic changes.

- [ ] **Step 6: typecheck + integration test**

Write `apps/worker/src/webhook-delivery.test.ts` that stubs `fetch` and asserts:
- HMAC header matches `crypto.createHmac("sha256", secret).update(body).digest("hex")`.
- On 200, status becomes `succeeded`.
- On 500, status remains `pending`, attempts increments, error is re-thrown.
- After 5 attempts, status becomes `dead`.

```bash
pnpm --filter @evo/worker test
pnpm --filter @evo/worker typecheck
pnpm --filter @evo/ingest typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/queue apps/ingest apps/worker
git commit -m "feat(worker,ingest): outbound webhook delivery with HMAC signing + retry"
```

---

## Task 5: Webhook deliveries viewer (UI)

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/settings/webhooks/[id]/page.tsx`
- Create: `apps/web/src/app/api/workspaces/[slug]/webhook-subscriptions/[id]/deliveries/route.ts`

- [ ] **Step 1: Deliveries API**

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const sub = await db.webhookSubscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundError("subscription not found");
    const deliveries = await db.webhookDelivery.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, event: true, status: true, attempts: true, responseStatus: true, lastAttemptAt: true, createdAt: true },
    });
    return NextResponse.json({ deliveries });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: UI page**

Simple table — id, event, status, attempts, last response, created. No pagination beyond the 100-row cap.

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/webhook-subscriptions/[id]/deliveries" "apps/web/src/app/[workspaceSlug]/settings/webhooks/[id]"
git commit -m "feat(web): webhook deliveries viewer (last 100 attempts per subscription)"
```

---

## Task 6: Typebot configurator (TDD client)

**Files:**
- Create: `packages/evolution-client/src/typebot.ts` + `typebot.test.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/integrations/typebot/route.ts`
- Create: `apps/web/src/app/[workspaceSlug]/settings/integrations/typebot/page.tsx` + `typebot-form.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/settings/integrations/page.tsx` (hub) to add Typebot link.

- [ ] **Step 1: TDD test**

```typescript
// typebot.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { TypebotApi } from "./typebot";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

describe("TypebotApi.set", () => {
  it("posts to /typebot/set/<name>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const api = new TypebotApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.set("inst", { enabled: true, url: "https://typebot.example", typebot: "my-bot", expire: 30, keywordFinish: "stop", delayMessage: 1000, unknownMessage: "?", listeningFromMe: false });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/typebot/set/inst");
    expect(init.method).toBe("POST");
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
// typebot.ts
import type { EvolutionClient } from "./client";

export interface TypebotConfig {
  enabled: boolean;
  url: string;
  typebot: string;
  expire: number;
  keywordFinish: string;
  delayMessage: number;
  unknownMessage: string;
  listeningFromMe: boolean;
}

export class TypebotApi {
  constructor(private readonly client: EvolutionClient) {}
  async set(instanceName: string, config: TypebotConfig): Promise<void> {
    await this.client.request("POST", `/typebot/set/${encodeURIComponent(instanceName)}`, config);
  }
  async find(instanceName: string): Promise<unknown> {
    return this.client.request("GET", `/typebot/find/${encodeURIComponent(instanceName)}`);
  }
}
```

Export from `packages/evolution-client/src/index.ts`. Run tests; expect new test count.

- [ ] **Step 3: API route**

Mirror the Chatwoot pattern from Plan 6.5 INCLUDING the encrypt-token-at-rest fix:
- POST: validate, encrypt the `typebot` field's secret (`url` is not a secret but if Typebot requires an API token, encrypt it).
  - Actually Typebot's pass-through doesn't carry a secret token in the same way; if Evolution's payload needs no per-call secret, only encrypt `url` if Evolution requires a token here — engineer should check Evolution docs and apply encryption ONLY to fields that are credentials. If none, persist plain (and update this plan with what you found).
- POST: send plaintext to Evolution, persist encrypted blob.
- GET: omit credential fields; add `hasCredential` markers.

- [ ] **Step 4: UI**

Mirror the Chatwoot form shape (instance selector, fields, "leave blank to keep" hint if there are credentials). Add a Typebot link to the integrations hub page.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @evo/evolution-client test
pnpm --filter @evo/web typecheck
git add packages/evolution-client "apps/web/src/app/api/workspaces/[slug]/integrations/typebot" "apps/web/src/app/[workspaceSlug]/settings/integrations" 
git commit -m "feat(web,evolution-client): Typebot pass-through configurator + TypebotApi"
```

---

## Task 7: Final review

Verify:
- `WebhookDelivery` in `TENANTED_MODELS`.
- API auth: `verifyApiKey` returns null on missing/malformed/wrong-prefix/revoked tokens.
- `/api/v1/send` POST works with a valid bearer token; rejects with 401 otherwise.
- Webhook delivery: HMAC signature is valid against the stored `WebhookSubscription.secret`; failed deliveries reach `dead` after 5 attempts; pause/resume on the subscription is respected (`enabled: false` → marks deliveries dead).
- emitEvent is called at exactly the right finalisation points — no events fire from inside a transaction that might roll back.
- Typebot configurator: any credential field is encrypted at rest and never returned in GET (same treatment as Chatwoot).
- No `console.log`, no env reads without validation, error envelopes consistent.

Deferred (still out of scope after this plan):
- RabbitMQ / SQS / Kafka / Pusher configurators (no demand yet).
- Real billing / Stripe / dunning.
- Per-key scopes / rate limits on `/api/v1/*` (currently the key is full-workspace).
