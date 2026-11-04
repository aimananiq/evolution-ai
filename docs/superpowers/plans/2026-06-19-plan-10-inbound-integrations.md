# Plan 10 — Inbound Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Inbound Integrations** feature (the Pabbly/Make/Zapier/WooCommerce adapter). An external app POSTs arbitrary JSON to a per-integration webhook URL; we extract a recipient phone via a dot-path (`billing.billing_phone`), render a `{{var}}` caption template against the payload, and send a WhatsApp message via the workspace's instance. Includes a "Capture Response" flow so the user can record a sample payload and discover available field paths, an editor UI matching the Wasapbot screenshot, a "Send Test Message" action, and a per-integration delivery log.

**Architecture:**
- **Receiver lives in `apps/ingest`** (NOT a Next.js route handler). Justification: `apps/ingest` is already the project's only public, untrusted, unauthenticated-by-session HTTP surface (it receives Evolution webhooks at `/whatsapp/webhook/:workspaceId/:instanceId`). It already owns the conventions for raw-body reading, fast 200 responses, `WEBHOOK_INBOUND_ALLOW_UNSAFE`, raw `prisma` access (no tenant session), and Redis publish. Putting the public receiver here keeps the Next.js app session-only and avoids exposing a Next route to anonymous internet traffic. The editor/CRUD/test APIs and UI live in `apps/web` (session-guarded, `requireMember`).
- **Flow:** `POST /integration_webhook/:token` → ingest looks up `InboundIntegration` by `token` with raw `prisma` → derives `workspaceId` from the row → (if `enabled === false` → 200 no-op) → always persists `lastSamplePayload` + `lastReceivedAt` (so Capture Response works even when disabled) → extracts recipient via `recipientPathKey` → renders `captionTemplate` → enqueues a BullMQ `inbound-send` job → writes `InboundIntegrationLog` → returns 200 fast.
- **Send path:** enqueue (not synchronous) to a BullMQ `inbound-send` queue, processed in `apps/worker` by `inboundSendProcessor`, which calls `sendViaInstance(instanceId, { type: "text", to, text, userId: null })` — mirrors `broadcastSendProcessor`. Enqueue gives retries + isolates the public endpoint from Evolution latency/throttle.
- **Templating** is a new pure package `@evo/inbound-templating` (`getByPath`, `renderTemplate`, `normalisePhone`), fully unit-tested, reused by both ingest (render) and the test endpoint.

**Tech Stack:** TypeScript, Prisma/Postgres, BullMQ + Redis (`@evo/queue`), Next.js 15 App Router route handlers + next-intl, Node `http` server (ingest), `@evo/send`, vitest (unit + real-DB integration), Playwright (e2e).

**Security:** The receiver is a **public, token-authenticated** endpoint — no session. Authentication is the unguessable per-integration `token` in the URL path (`randomBytes(24).toString("base64url")`, `@unique`). Controls:
- **Constant-time-ish lookup:** single `prisma.inboundIntegration.findUnique({ where: { token } })`; unknown token → 404. Disabled integration → 200 no-op (do not leak existence vs enabled state beyond this).
- **Payload size cap:** reject bodies over `INBOUND_MAX_BODY_BYTES` (default 256 KiB) with 413 before parsing.
- **Rate-limit note:** per-token rate limit via the existing `tokenBucket` from `@evo/queue` (bucket key `inbound:<integrationId>`) — see Task 3; abusive tokens get 429. Document that Caddy/edge rate-limiting is the outer defence.
- **No reflection of internal data:** the 422 "no recipient" response returns only `{ error: "NO_RECIPIENT" }`, never the payload. The captured sample is only readable through the session-guarded editor poll API.
- `WEBHOOK_INBOUND_ALLOW_UNSAFE=true` only relaxes dev-mode checks, mirroring the Evolution receiver.

**Depends on:** Plan 7 (MediaPicker + `mediaAssetId` send variant) — **optional**. `mediaAssetId` column is added now; the UI media picker and media send are gated behind Plan 7 and degrade gracefully (text-only) until then.

---

## File Structure

```
packages/
  db/
    prisma/schema.prisma                         # + InboundIntegration, InboundIntegrationLog, InboundLogStatus enum
    prisma/migrations/<ts>_inbound_integrations/ # migration
    src/tenant.ts                                # + 2 models to TENANTED_MODELS
  inbound-templating/                            # NEW pure package @evo/inbound-templating
    package.json
    tsconfig.json
    vitest.config.ts
    src/index.ts                                 # getByPath, renderTemplate, normalisePhone, collectPaths
    src/index.test.ts
apps/
  ingest/
    package.json                                 # + @evo/inbound-templating dep
    src/inbound.ts                               # NEW: handleInbound(token, rawBody) -> {status, body}
    src/inbound.test.ts                          # real-DB integration test
    src/index.ts                                 # + route: POST /integration_webhook/:token
  worker/
    src/inbound-send.ts                          # NEW: inboundSendProcessor (mirrors broadcast-send)
    src/inbound-send.test.ts
    src/index.ts                                 # + register inbound-send queue + worker
  web/
    src/lib/inbound-queue.ts                     # NEW: enqueueInboundSend (shared by ingest? no — ingest enqueues directly; this is for /test)
    src/app/api/workspaces/[slug]/inbound-integrations/route.ts           # list + create
    src/app/api/workspaces/[slug]/inbound-integrations/[id]/route.ts      # get + update + delete
    src/app/api/workspaces/[slug]/inbound-integrations/[id]/capture/route.ts  # toggle capture + poll sample
    src/app/api/workspaces/[slug]/inbound-integrations/[id]/test/route.ts     # send test message
    src/app/api/workspaces/[slug]/inbound-integrations/[id]/logs/route.ts     # list logs
    src/app/[workspaceSlug]/integrations/page.tsx                         # list (server) — extend existing integrations hub if present
    src/app/[workspaceSlug]/integrations/inbound/page.tsx                 # list page (server)
    src/app/[workspaceSlug]/integrations/inbound/inbound-list.tsx         # "use client" list
    src/app/[workspaceSlug]/integrations/inbound/[id]/page.tsx            # editor (server)
    src/app/[workspaceSlug]/integrations/inbound/[id]/editor.tsx          # "use client" editor
    messages/en-GB.json                          # + inboundIntegrations namespace
    tests/e2e/inbound-integrations.spec.ts       # e2e
.env.example                                     # + INBOUND_MAX_BODY_BYTES
```

> **Naming contract (use these EXACT names across all tasks):**
> - Models: `InboundIntegration`, `InboundIntegrationLog`; enum `InboundLogStatus { received sent failed no_recipient }`.
> - Fields on `InboundIntegration`: `id, workspaceId, name, description?, instanceId, token, enabled, recipientPathKey, captionTemplate, mediaAssetId?, captureArmed, lastReceivedAt?, lastSamplePayload?, createdAt, updatedAt`.
> - Fields on `InboundIntegrationLog`: `id, workspaceId, integrationId, payload, resolvedPhone?, status, error?, createdAt`.
> - Queue name: `"inbound-send"`. Job type: `InboundSendJob { integrationId, instanceId, to, text, logId }`.
> - URL path: `/integration_webhook/:token`. Webhook URL shown to user: `${WEBHOOK_PUBLIC_BASE_URL}/integration_webhook/${token}`.

---

### Task 1: Schema — `InboundIntegration` + `InboundIntegrationLog` + migration

**Files:**
- `packages/db/prisma/schema.prisma`
- `packages/db/src/tenant.ts`

- [ ] Add the enum and two models to the end of `packages/db/prisma/schema.prisma`:

```prisma
enum InboundLogStatus {
  received
  sent
  failed
  no_recipient
}

model InboundIntegration {
  id               String   @id @default(cuid())
  workspaceId      String
  instanceId       String
  name             String
  description      String?
  token            String   @unique
  enabled          Boolean  @default(true)
  recipientPathKey String
  captionTemplate  String
  mediaAssetId     String?
  captureArmed     Boolean  @default(false)
  lastReceivedAt   DateTime?
  lastSamplePayload Json?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  workspace Workspace                @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance                 @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  logs      InboundIntegrationLog[]

  @@index([workspaceId, createdAt])
  @@index([instanceId])
}

model InboundIntegrationLog {
  id            String           @id @default(cuid())
  workspaceId   String
  integrationId String
  payload       Json
  resolvedPhone String?
  status        InboundLogStatus
  error         String?
  createdAt     DateTime         @default(now())

  workspace   Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  integration InboundIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  @@index([integrationId, createdAt])
  @@index([workspaceId, createdAt])
}
```

- [ ] Add back-relations on `model Workspace` (alongside the existing `integrations WorkspaceIntegration[]` line):

```prisma
  inboundIntegrations     InboundIntegration[]
  inboundIntegrationLogs  InboundIntegrationLog[]
```

- [ ] Add back-relation on `model Instance` (alongside `integrations WorkspaceIntegration[]`):

```prisma
  inboundIntegrations InboundIntegration[]
```

- [ ] Register both new models in `packages/db/src/tenant.ts` `TENANTED_MODELS` set (add after `"WorkspaceIntegration",`):

```ts
  "InboundIntegration",
  "InboundIntegrationLog",
```

- [ ] Generate the migration from repo root (uses `.env`):

```bash
pnpm --filter @evo/db migrate -- --name inbound_integrations
```

Expected: a new folder `packages/db/prisma/migrations/<timestamp>_inbound_integrations/migration.sql` is created and applied; output ends with `Your database is now in sync with your schema.` and the generated client is regenerated.

- [ ] Verify the client typechecks:

```bash
pnpm --filter @evo/db typecheck
```

Expected: exit 0, no output.

- [ ] **Commit:** `feat(db): inbound integration + log models`

---

### Task 2: `@evo/inbound-templating` — JSON path + template + phone helpers (pure, fully unit-tested)

**Files:**
- `packages/inbound-templating/package.json`
- `packages/inbound-templating/tsconfig.json`
- `packages/inbound-templating/vitest.config.ts`
- `packages/inbound-templating/src/index.ts`
- `packages/inbound-templating/src/index.test.ts`

- [ ] `packages/inbound-templating/package.json`:

```json
{
  "name": "@evo/inbound-templating",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] `packages/inbound-templating/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] `packages/inbound-templating/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] `packages/inbound-templating/src/index.ts` — write the COMPLETE implementation:

```ts
/**
 * Resolve a dot-path against an arbitrary JSON value.
 * Supports nested objects and numeric array indices: "a.b", "a.0.b".
 * Returns undefined for any missing/invalid segment. Never throws.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(".");
  let cur: any = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Render a template, replacing {{a.b.c}} tokens with the stringified value at
 * that path in `payload`. Whitespace inside braces is tolerated: {{ a.b }}.
 * Missing paths render as an empty string. Non-string scalars are coerced;
 * objects/arrays are JSON.stringify'd.
 */
export function renderTemplate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^}\s][^}]*?)\s*\}\}/g, (_m, rawPath: string) => {
    const value = getByPath(payload, rawPath.trim());
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

/**
 * Normalise a raw phone string to a bare E.164-style digit string (no '+',
 * no spaces/dashes/parens). Returns null if no digits remain. If the input
 * already looks like a JID ("60123@s.whatsapp.net" / "...@g.us") it is
 * returned unchanged so group/JID recipients pass through.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/@(s\.whatsapp\.net|g\.us|lid)$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits.length >= 6 ? digits : null;
}

/**
 * Walk a sample payload and collect every leaf dot-path (and intermediate
 * array index paths) so the editor can offer variable-insert buttons.
 * Caps total paths to `limit` to avoid pathological payloads.
 */
export function collectPaths(obj: unknown, limit = 200): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (out.length >= limit) return;
    if (node == null || typeof node !== "object") {
      if (prefix) out.push(prefix);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, prefix ? `${prefix}.${i}` : String(i)));
    } else {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    }
  };
  walk(obj, "");
  return out.slice(0, limit);
}
```

- [ ] `packages/inbound-templating/src/index.test.ts` — COMPLETE tests:

```ts
import { describe, it, expect } from "vitest";
import { getByPath, renderTemplate, normalisePhone, collectPaths } from "./index";

describe("getByPath", () => {
  const sample = { billing: { billing_phone: "60123", addr: { city: "KL" } }, items: [{ sku: "A" }, { sku: "B" }] };
  it("resolves nested object paths", () => {
    expect(getByPath(sample, "billing.billing_phone")).toBe("60123");
    expect(getByPath(sample, "billing.addr.city")).toBe("KL");
  });
  it("resolves array index paths", () => {
    expect(getByPath(sample, "items.0.sku")).toBe("A");
    expect(getByPath(sample, "items.1.sku")).toBe("B");
  });
  it("returns undefined for missing keys", () => {
    expect(getByPath(sample, "billing.nope")).toBeUndefined();
    expect(getByPath(sample, "a.b.c.d")).toBeUndefined();
    expect(getByPath(sample, "items.9.sku")).toBeUndefined();
  });
  it("returns undefined for empty path or non-object root", () => {
    expect(getByPath(sample, "")).toBeUndefined();
    expect(getByPath("string", "a")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  const payload = { name: "Aiman", order: { id: 42, total: 99.5 }, tags: ["vip", "new"] };
  it("substitutes single and multiple variables", () => {
    expect(renderTemplate("Hi {{name}}", payload)).toBe("Hi Aiman");
    expect(renderTemplate("{{name}} #{{order.id}} = {{order.total}}", payload)).toBe("Aiman #42 = 99.5");
  });
  it("tolerates whitespace inside braces", () => {
    expect(renderTemplate("Hi {{  name  }}", payload)).toBe("Hi Aiman");
  });
  it("renders missing paths as empty string", () => {
    expect(renderTemplate("Hi {{missing.path}}!", payload)).toBe("Hi !");
  });
  it("JSON-stringifies object/array values", () => {
    expect(renderTemplate("{{tags}}", payload)).toBe('["vip","new"]');
  });
  it("leaves text without tokens untouched", () => {
    expect(renderTemplate("no tokens here", payload)).toBe("no tokens here");
  });
});

describe("normalisePhone", () => {
  it("strips formatting to bare digits", () => {
    expect(normalisePhone("+60 12-345 6789")).toBe("60123456789");
    expect(normalisePhone("(601) 234-5678")).toBe("6012345678");
  });
  it("accepts numeric input", () => {
    expect(normalisePhone(60123456789)).toBe("60123456789");
  });
  it("passes JIDs through unchanged", () => {
    expect(normalisePhone("60123@s.whatsapp.net")).toBe("60123@s.whatsapp.net");
    expect(normalisePhone("12345-678@g.us")).toBe("12345-678@g.us");
  });
  it("returns null for junk / too-short / non-string", () => {
    expect(normalisePhone("abc")).toBeNull();
    expect(normalisePhone("123")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone({})).toBeNull();
  });
});

describe("collectPaths", () => {
  it("collects leaf paths including array indices", () => {
    const paths = collectPaths({ a: { b: 1 }, c: [{ d: 2 }] });
    expect(paths).toEqual(["a.b", "c.0.d"]);
  });
  it("respects the limit", () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    expect(collectPaths(big, 10)).toHaveLength(10);
  });
});
```

- [ ] Run the unit tests:

```bash
pnpm --filter @evo/inbound-templating test
```

Expected: all tests pass — `Test Files  1 passed (1)` / `Tests  N passed`.

- [ ] **Commit:** `feat(inbound-templating): pure json-path + template + phone helpers`

---

### Task 3: Receiver — `handleInbound` + `POST /integration_webhook/:token` in `apps/ingest`

**Files:**
- `apps/ingest/package.json` (add dep)
- `apps/ingest/src/inbound.ts` (new)
- `apps/ingest/src/inbound.test.ts` (new)
- `apps/ingest/src/index.ts` (wire route)
- `.env.example` (add `INBOUND_MAX_BODY_BYTES`)

- [ ] Add the dependency to `apps/ingest/package.json` `dependencies` (alphabetical, after `@evo/evolution-client`):

```json
    "@evo/inbound-templating": "workspace:*",
```

- [ ] Add to `.env.example` near `WEBHOOK_PUBLIC_BASE_URL`:

```bash
# Max accepted body size (bytes) for the public inbound-integration receiver
INBOUND_MAX_BODY_BYTES="262144"
```

- [ ] Write `apps/ingest/src/inbound.ts` — COMPLETE. This is pure-ish (takes parsed body) so it is unit-testable; the HTTP wiring in `index.ts` only reads the body + enforces the size cap. Enqueues to BullMQ; on enqueue failure marks the log `failed`.

```ts
import { prisma } from "@evo/db";
import { Queue } from "bullmq";
import { redis, tokenBucket } from "@evo/queue";
import { getByPath, renderTemplate, normalisePhone } from "@evo/inbound-templating";

export const INBOUND_SEND_QUEUE = "inbound-send";

export interface InboundSendJob {
  integrationId: string;
  instanceId: string;
  to: string;
  text: string;
  logId: string;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

// Lazily-created queue (shares the ingest Redis connection).
let _queue: Queue<InboundSendJob> | null = null;
function sendQueue(): Queue<InboundSendJob> {
  if (!_queue) _queue = new Queue<InboundSendJob>(INBOUND_SEND_QUEUE, { connection: redis() as any });
  return _queue;
}

const RATE = { capacity: 30, refillPerSecond: 1 };

/**
 * Core receiver logic. `payload` is the already-parsed JSON body.
 * Returns the HTTP status + JSON body to send back.
 */
export async function handleInbound(token: string, payload: unknown): Promise<InboundResult> {
  const integration = await prisma.inboundIntegration.findUnique({ where: { token } });
  if (!integration) return { status: 404, body: { error: "NOT_FOUND" } };

  // Per-token rate limit (best-effort; never blocks indefinitely).
  const bucket = tokenBucket(`inbound:${integration.id}`, RATE);
  const taken = await bucket.take({ waitMs: 0 });
  if (!taken.granted) return { status: 429, body: { error: "RATE_LIMITED" } };

  // ALWAYS record the sample so Capture Response works, even when disabled.
  await prisma.inboundIntegration.update({
    where: { id: integration.id },
    data: { lastReceivedAt: new Date(), lastSamplePayload: payload as any },
  });

  if (!integration.enabled) {
    // Acknowledge but do nothing (and do not write a delivery log).
    return { status: 200, body: { ok: true, skipped: "disabled" } };
  }

  const rawPhone = getByPath(payload, integration.recipientPathKey);
  const to = normalisePhone(rawPhone);

  if (!to) {
    await prisma.inboundIntegrationLog.create({
      data: {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        payload: payload as any,
        resolvedPhone: null,
        status: "no_recipient",
        error: `no recipient at path "${integration.recipientPathKey}"`,
      },
    });
    return { status: 422, body: { error: "NO_RECIPIENT" } };
  }

  const text = renderTemplate(integration.captionTemplate, payload);
  const log = await prisma.inboundIntegrationLog.create({
    data: {
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
      payload: payload as any,
      resolvedPhone: to,
      status: "received",
    },
  });

  try {
    await sendQueue().add(
      "send",
      { integrationId: integration.id, instanceId: integration.instanceId, to, text, logId: log.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: 100 },
    );
  } catch (err: any) {
    await prisma.inboundIntegrationLog.update({
      where: { id: log.id },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
    return { status: 200, body: { ok: true, queued: false } };
  }

  return { status: 200, body: { ok: true, queued: true } };
}
```

- [ ] Wire the route into `apps/ingest/src/index.ts`. Add the import near the top:

```ts
import { handleInbound } from "./inbound.js";
```

  Then add this block **before** the existing `/whatsapp/webhook/...` match (inside the request handler, after the `/healthz` block):

```ts
  const inboundMatch = req.url?.match(/^\/integration_webhook\/([^/?]+)/);
  if (inboundMatch && req.method === "POST") {
    const [, token] = inboundMatch;
    const maxBytes = Number(process.env.INBOUND_MAX_BODY_BYTES ?? 262144);
    try {
      const buf = await readBody(req);
      if (buf.length > maxBytes) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      let payload: unknown = {};
      if (buf.length) {
        try {
          payload = JSON.parse(buf.toString("utf8"));
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INVALID_JSON" }));
          return;
        }
      }
      const result = await handleInbound(token!, payload);
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      log.error({ err: String(err) }, "inbound integration failed");
      res.writeHead(500).end();
    }
    return;
  }
```

- [ ] Write `apps/ingest/src/inbound.test.ts` — real-DB integration test (mirrors `persist.test.ts` style; relies on `test-setup.ts`). Note: it asserts DB side-effects + return status; it does NOT assert the actual WhatsApp send (that is the worker's job, Task 5).

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { handleInbound } from "./inbound";

const { prisma } = await import("@evo/db");

let workspaceId: string;
let instanceId: string;

async function makeIntegration(over: Partial<{ enabled: boolean; recipientPathKey: string; captionTemplate: string }> = {}) {
  return prisma.inboundIntegration.create({
    data: {
      workspaceId,
      instanceId,
      name: "Webhook #test",
      token: "tok-" + Math.random().toString(36).slice(2),
      enabled: over.enabled ?? true,
      recipientPathKey: over.recipientPathKey ?? "billing.billing_phone",
      captionTemplate: over.captionTemplate ?? "Hi {{billing.first_name}}, order {{order.id}} received.",
    },
  });
}

beforeEach(async () => {
  await prisma.inboundIntegrationLog.deleteMany();
  await prisma.inboundIntegration.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "t-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "main", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
});

describe("handleInbound", () => {
  it("404s for an unknown token", async () => {
    const r = await handleInbound("does-not-exist", { a: 1 });
    expect(r.status).toBe(404);
  });

  it("resolves recipient, writes a received log, and stores the sample", async () => {
    const integ = await makeIntegration();
    const payload = { billing: { billing_phone: "+60 12-345 6789", first_name: "Aiman" }, order: { id: 7 } };
    const r = await handleInbound(integ.token, payload);
    expect(r.status).toBe(200);

    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe("received");
    expect(logs[0]?.resolvedPhone).toBe("60123456789");

    const fresh = await prisma.inboundIntegration.findUnique({ where: { id: integ.id } });
    expect(fresh?.lastReceivedAt).toBeTruthy();
    expect((fresh?.lastSamplePayload as any).order.id).toBe(7);
  });

  it("logs no_recipient + 422 when path is missing", async () => {
    const integ = await makeIntegration({ recipientPathKey: "billing.nope" });
    const r = await handleInbound(integ.token, { billing: { first_name: "X" } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("NO_RECIPIENT");
    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs[0]?.status).toBe("no_recipient");
  });

  it("stores sample but does NOT log/send when disabled", async () => {
    const integ = await makeIntegration({ enabled: false });
    const r = await handleInbound(integ.token, { billing: { billing_phone: "60123456789" } });
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe("disabled");
    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs).toHaveLength(0);
    const fresh = await prisma.inboundIntegration.findUnique({ where: { id: integ.id } });
    expect(fresh?.lastSamplePayload).toBeTruthy();
  });
});
```

- [ ] Run the ingest tests (requires the test Postgres + Redis from `test-setup.ts`):

```bash
pnpm --filter @evo/ingest test
```

Expected: existing tests still pass and `inbound.test.ts` passes — all 4 `handleInbound` cases green.

- [ ] **Commit:** `feat(ingest): public inbound-integration receiver + tests`

---

### Task 4: Capture Response — arm/poll API (editor field discovery)

**Files:**
- `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/[id]/capture/route.ts`

**Design:** "Capture Response" is implemented WITHOUT a separate capture buffer. The receiver (Task 3) ALWAYS writes `lastSamplePayload`/`lastReceivedAt` on every inbound POST (even disabled). The editor's "Capture Response" button:
1. `POST .../capture` with `{ arm: true }` → sets `captureArmed = true` and records the baseline `lastReceivedAt` (returned to client).
2. Editor polls `GET .../capture` → returns `{ captureArmed, lastReceivedAt, sample, paths }`. When `lastReceivedAt` advances past the baseline the client knows a fresh submission arrived and renders `paths` (from `collectPaths(sample)`) as variable-insert buttons.
3. The client disarms by `POST { arm: false }` once it has the sample. `captureArmed` is purely a UI hint; the receiver never gates on it (so users don't miss a real submission).

- [ ] Write `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/[id]/capture/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { collectPaths } from "@evo/inbound-templating";

const schema = z.object({ arm: z.boolean() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const row = await db.inboundIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Integration not found");
    const sample = (row.lastSamplePayload as unknown) ?? null;
    return NextResponse.json({
      captureArmed: row.captureArmed,
      lastReceivedAt: row.lastReceivedAt,
      sample,
      paths: sample ? collectPaths(sample) : [],
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    await db.inboundIntegration.update({ where: { id }, data: { captureArmed: parsed.data.arm } });
    return NextResponse.json({ captureArmed: parsed.data.arm, lastReceivedAt: existing.lastReceivedAt });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Add `@evo/inbound-templating` to `apps/web/package.json` dependencies if not already present:

```json
    "@evo/inbound-templating": "workspace:*",
```

- [ ] Typecheck web:

```bash
pnpm --filter @evo/web typecheck
```

Expected: exit 0.

- [ ] **Commit:** `feat(web): capture-response arm/poll API for inbound integrations`

---

### Task 5: Send worker — `inboundSendProcessor` (BullMQ `inbound-send`)

**Files:**
- `apps/worker/src/inbound-send.ts` (new)
- `apps/worker/src/inbound-send.test.ts` (new)
- `apps/worker/src/index.ts` (register queue + worker)

- [ ] Write `apps/worker/src/inbound-send.ts` — mirrors `broadcast-send.ts`, updating the log row:

```ts
import type { Processor } from "bullmq";
import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

export interface InboundSendJob {
  integrationId: string;
  instanceId: string;
  to: string;
  text: string;
  logId: string;
}

export const inboundSendProcessor: Processor<InboundSendJob> = async (job) => {
  const { instanceId, to, text, logId } = job.data;
  try {
    await sendViaInstance(instanceId, { type: "text", to, text, userId: null });
    await prisma.inboundIntegrationLog.update({ where: { id: logId }, data: { status: "sent" } });
  } catch (err: any) {
    await prisma.inboundIntegrationLog.update({
      where: { id: logId },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
    throw err; // let BullMQ retry per the job's attempts/backoff
  }
};
```

- [ ] Register in `apps/worker/src/index.ts`. Add the import alongside the others:

```ts
import { inboundSendProcessor } from "./inbound-send.js";
```

  Add after the warmer queues block (before the `http.createServer`):

```ts
const INBOUND_SEND_QUEUE = "inbound-send";
new Worker(INBOUND_SEND_QUEUE, inboundSendProcessor as any, { connection, concurrency: 4 });
```

- [ ] Write `apps/worker/src/inbound-send.test.ts` — unit test with `sendViaInstance` mocked, real DB for the log row:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));

const { sendViaInstance } = await import("@evo/send");
const { prisma } = await import("@evo/db");
const { inboundSendProcessor } = await import("./inbound-send");

let workspaceId: string;
let instanceId: string;
let integrationId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.inboundIntegrationLog.deleteMany();
  await prisma.inboundIntegration.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "w-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "m", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const integ = await prisma.inboundIntegration.create({
    data: { workspaceId: ws.id, instanceId: inst.id, name: "W", token: "t-" + Date.now(), recipientPathKey: "p", captionTemplate: "x" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
  integrationId = integ.id;
});

function job(logId: string) {
  return { data: { integrationId, instanceId, to: "60123456789", text: "hi", logId } } as any;
}

describe("inboundSendProcessor", () => {
  it("marks the log 'sent' on success", async () => {
    (sendViaInstance as any).mockResolvedValue({ key: { id: "X" } });
    const log = await prisma.inboundIntegrationLog.create({
      data: { workspaceId, integrationId, payload: {}, resolvedPhone: "60123456789", status: "received" },
    });
    await inboundSendProcessor(job(log.id), "" as any);
    expect(sendViaInstance).toHaveBeenCalledWith(instanceId, { type: "text", to: "60123456789", text: "hi", userId: null });
    const fresh = await prisma.inboundIntegrationLog.findUnique({ where: { id: log.id } });
    expect(fresh?.status).toBe("sent");
  });

  it("marks the log 'failed' and rethrows on send error", async () => {
    (sendViaInstance as any).mockRejectedValue(new Error("boom"));
    const log = await prisma.inboundIntegrationLog.create({
      data: { workspaceId, integrationId, payload: {}, resolvedPhone: "60123456789", status: "received" },
    });
    await expect(inboundSendProcessor(job(log.id), "" as any)).rejects.toThrow("boom");
    const fresh = await prisma.inboundIntegrationLog.findUnique({ where: { id: log.id } });
    expect(fresh?.status).toBe("failed");
    expect(fresh?.error).toContain("boom");
  });
});
```

- [ ] Run worker tests:

```bash
pnpm --filter @evo/worker test
```

Expected: both cases pass.

- [ ] **Commit:** `feat(worker): inbound-send processor + queue registration`

---

### Task 6: CRUD API — list/create + get/update/delete + test + logs

**Files:**
- `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/[id]/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/[id]/test/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/inbound-integrations/[id]/logs/route.ts`

- [ ] Write `.../inbound-integrations/route.ts` (list = Viewer+, create = Admin; auto-name `Webhook #<ISO timestamp>`; generate token):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const createSchema = z.object({
  instanceId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  recipientPathKey: z.string().min(1).default("billing.billing_phone"),
  captionTemplate: z.string().default(""),
  mediaAssetId: z.string().optional(),
  enabled: z.boolean().default(true),
});

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const rows = await db.inboundIntegration.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, enabled: true, instanceId: true, recipientPathKey: true, lastReceivedAt: true, createdAt: true },
    });
    return NextResponse.json({ integrations: rows });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const token = randomBytes(24).toString("base64url");
    const row = await db.inboundIntegration.create({
      data: {
        instanceId: parsed.data.instanceId,
        name: parsed.data.name ?? `Webhook #${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
        description: parsed.data.description,
        token,
        enabled: parsed.data.enabled,
        recipientPathKey: parsed.data.recipientPathKey,
        captionTemplate: parsed.data.captionTemplate,
        mediaAssetId: parsed.data.mediaAssetId,
      } as any,
    });
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Write `.../inbound-integrations/[id]/route.ts` (GET returns the full editor payload incl. `webhookUrl`; PATCH updates; DELETE):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  instanceId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  recipientPathKey: z.string().min(1).optional(),
  captionTemplate: z.string().optional(),
  mediaAssetId: z.string().nullable().optional(),
});

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const row = await db.inboundIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Integration not found");
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    if (parsed.data.instanceId) {
      const inst = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
      if (!inst) throw new NotFoundError("Instance not found");
    }
    const row = await db.inboundIntegration.update({ where: { id }, data: parsed.data as any });
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } });
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
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    await db.inboundIntegration.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Write `.../inbound-integrations/[id]/test/route.ts` (Send Test Message: render caption against the captured sample, send to a supplied test recipient — synchronous so the user gets immediate feedback):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { renderTemplate, normalisePhone } from "@evo/inbound-templating";
import { sendViaInstance } from "@evo/send";

const schema = z.object({ to: z.string().min(3) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const to = normalisePhone(parsed.data.to);
    if (!to) return NextResponse.json({ error: "INVALID_RECIPIENT" }, { status: 400 });

    const db = tenantClient(workspace.id);
    const integ = await db.inboundIntegration.findUnique({ where: { id } });
    if (!integ) throw new NotFoundError("Integration not found");

    const sample = (integ.lastSamplePayload as unknown) ?? {};
    const text = renderTemplate(integ.captionTemplate, sample) || "(test message)";

    await sendViaInstance(integ.instanceId, { type: "text", to, text, userId: null });
    return NextResponse.json({ ok: true, sent: { to, text } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: "SEND_FAILED", detail: e.message }, { status: 502 });
    throw e;
  }
}
```

- [ ] Write `.../inbound-integrations/[id]/logs/route.ts` (Viewer+, last 50):

```ts
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const integ = await db.inboundIntegration.findUnique({ where: { id }, select: { id: true } });
    if (!integ) throw new NotFoundError("Integration not found");
    const logs = await db.inboundIntegrationLog.findMany({
      where: { integrationId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, resolvedPhone: true, status: true, error: true, createdAt: true },
    });
    return NextResponse.json({ logs });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Typecheck:

```bash
pnpm --filter @evo/web typecheck
```

Expected: exit 0.

- [ ] **Commit:** `feat(web): inbound-integrations CRUD + test + logs API`

---

### Task 7: UI — list page + editor (matches the Wasapbot screenshot) + logs

**Files:**
- `apps/web/src/app/[workspaceSlug]/integrations/inbound/page.tsx`
- `apps/web/src/app/[workspaceSlug]/integrations/inbound/inbound-list.tsx`
- `apps/web/src/app/[workspaceSlug]/integrations/inbound/[id]/page.tsx`
- `apps/web/src/app/[workspaceSlug]/integrations/inbound/[id]/editor.tsx`
- `apps/web/messages/en-GB.json` (+ `inboundIntegrations` namespace)
- workspace nav component (add link)

- [ ] Add an `inboundIntegrations` namespace to `apps/web/messages/en-GB.json` (insert before the closing brace, matching existing indentation):

```json
  "inboundIntegrations": {
    "title": "Integrations",
    "subtitle": "Receive data from external apps (Pabbly, Make, WooCommerce) and send a WhatsApp message.",
    "addNew": "Add integration",
    "empty": "No integrations yet. Click + to create one.",
    "status": "Status",
    "enable": "Enable",
    "disable": "Disable",
    "name": "Name",
    "description": "Description",
    "selectAccount": "Select Account",
    "instanceId": "Your Instance Id",
    "webhookUrl": "Webhook URL",
    "webhookHint": "Copy this URL and paste it into the Webhook URL field of the app you are integrating.",
    "copy": "Copy",
    "copied": "Copied",
    "captureResponse": "Capture Response",
    "capturing": "Waiting for a test submission…",
    "captured": "Captured! Use the fields below in your caption.",
    "recipientKey": "Recipient Phone Number Key",
    "recipientKeyHint": "Required. Field label for the recipient number without brackets. Eg: billing.billing_phone",
    "caption": "Caption",
    "captionPlaceholder": "Write a caption",
    "insertVariable": "Insert variable",
    "sendTest": "Send Test Message",
    "testRecipient": "Test Recipient Number",
    "send": "Send",
    "save": "Submit",
    "back": "Back",
    "delete": "Delete",
    "logs": "Recent deliveries",
    "logEmpty": "No deliveries yet.",
    "colWhen": "When",
    "colPhone": "Recipient",
    "colStatus": "Status",
    "colError": "Error"
  }
```

- [ ] Write the list server page `.../integrations/inbound/page.tsx` (mirror `templates/page.tsx`):

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import InboundList from "./inbound-list";

export default async function InboundIntegrationsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const [integrations, instances] = await Promise.all([
    db.inboundIntegration.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, enabled: true, lastReceivedAt: true } }),
    db.instance.findMany({ select: { id: true, label: true } }),
  ]);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("inboundIntegrations.title")}</h1>
      <InboundList
        workspaceSlug={workspaceSlug}
        instances={instances}
        initial={integrations.map((i) => ({ id: i.id, name: i.name, enabled: i.enabled, lastReceivedAt: i.lastReceivedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
```

- [ ] Write `.../integrations/inbound/inbound-list.tsx` (`"use client"`): renders the list (empty-state box when empty), a search box, and a "+ Add" button that `POST`s to create then routes to the editor. Keep it minimal but functional:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface Row { id: string; name: string; enabled: boolean; lastReceivedAt: string | null }
interface Instance { id: string; label: string }

export default function InboundList({ workspaceSlug, instances, initial }: { workspaceSlug: string; instances: Instance[]; initial: Row[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [rows] = useState<Row[]>(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!instances[0]) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/inbound-integrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId: instances[0].id }),
    });
    setBusy(false);
    if (res.ok) {
      const { integration } = await res.json();
      router.push(`/${workspaceSlug}/integrations/inbound/${integration.id}`);
    }
  }

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <input className="rounded border px-3 py-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" onClick={add} disabled={busy || instances.length === 0}>
          + {t("inboundIntegrations.addNew")}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded border border-dashed p-10 text-center text-sm text-gray-500">{t("inboundIntegrations.empty")}</div>
      ) : (
        <ul className="divide-y rounded border">
          {filtered.map((r) => (
            <li key={r.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
              <button className="text-left" onClick={() => router.push(`/${workspaceSlug}/integrations/inbound/${r.id}`)}>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-gray-500">{r.enabled ? t("inboundIntegrations.enable") : t("inboundIntegrations.disable")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] Write the editor server page `.../integrations/inbound/[id]/page.tsx`:

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import InboundEditor from "./editor";

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export default async function InboundEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const [row, instances] = await Promise.all([
    db.inboundIntegration.findUnique({ where: { id } }),
    db.instance.findMany({ select: { id: true, label: true } }),
  ]);
  if (!row) notFound();
  return (
    <InboundEditor
      workspaceSlug={workspaceSlug}
      instances={instances}
      initial={{
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        instanceId: row.instanceId,
        enabled: row.enabled,
        recipientPathKey: row.recipientPathKey,
        captionTemplate: row.captionTemplate,
        webhookUrl: `${baseUrl()}/integration_webhook/${row.token}`,
        lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
      }}
    />
  );
}
```

- [ ] Write `.../integrations/inbound/[id]/editor.tsx` (`"use client"`) — the screenshot's form. Includes: Status toggle, Name, Description, instance select, read-only Webhook URL + Copy, Capture Response (arms + polls `capture` until `lastReceivedAt` advances, then shows variable buttons from `paths`), recipient key input, caption textarea with a cursor-insert helper for `{{path}}`, Send Test, Save (PATCH), Delete, and a logs panel that fetches `/logs`. Media via `<MediaPicker>` is **gated behind Plan 7** — render the picker only if the component exists, otherwise text-only:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface Instance { id: string; label: string }
interface Initial {
  id: string; name: string; description: string; instanceId: string; enabled: boolean;
  recipientPathKey: string; captionTemplate: string; webhookUrl: string; lastReceivedAt: string | null;
}
interface LogRow { id: string; resolvedPhone: string | null; status: string; error: string | null; createdAt: string }

export default function InboundEditor({ workspaceSlug, instances, initial }: { workspaceSlug: string; instances: Instance[]; initial: Initial }) {
  const t = useTranslations();
  const router = useRouter();
  const api = `/api/workspaces/${workspaceSlug}/inbound-integrations/${initial.id}`;

  const [enabled, setEnabled] = useState(initial.enabled);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [instanceId, setInstanceId] = useState(initial.instanceId);
  const [recipientPathKey, setRecipientPathKey] = useState(initial.recipientPathKey);
  const [caption, setCaption] = useState(initial.captionTemplate);
  const [paths, setPaths] = useState<string[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void loadLogs(); }, []);
  async function loadLogs() {
    const res = await fetch(`${api}/logs`);
    if (res.ok) setLogs((await res.json()).logs);
  }

  async function save() {
    await fetch(api, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, instanceId, enabled, recipientPathKey, captionTemplate: caption }),
    });
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this integration?")) return;
    await fetch(api, { method: "DELETE" });
    router.push(`/${workspaceSlug}/integrations/inbound`);
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(initial.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function capture() {
    setCapturing(true);
    const armRes = await fetch(`${api}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arm: true }) });
    const baseline = armRes.ok ? (await armRes.json()).lastReceivedAt : initial.lastReceivedAt;
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const res = await fetch(`${api}/capture`);
      if (res.ok) {
        const data = await res.json();
        if (data.lastReceivedAt && data.lastReceivedAt !== baseline) {
          setPaths(data.paths ?? []);
          setCapturing(false);
          await fetch(`${api}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arm: false }) });
          return;
        }
      }
      if (Date.now() < deadline) setTimeout(poll, 2000);
      else setCapturing(false);
    };
    setTimeout(poll, 2000);
  }

  function insertVar(p: string) {
    const ta = captionRef.current;
    const token = `{{${p}}}`;
    if (!ta) { setCaption((c) => c + token); return; }
    const start = ta.selectionStart ?? caption.length;
    const end = ta.selectionEnd ?? caption.length;
    setCaption(caption.slice(0, start) + token + caption.slice(end));
  }

  async function sendTest() {
    const res = await fetch(`${api}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testTo }) });
    alert(res.ok ? "Sent" : "Failed: " + ((await res.json()).error ?? "error"));
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-semibold">{t("inboundIntegrations.title")}</h1>

      <fieldset>
        <legend className="font-medium">{t("inboundIntegrations.status")}</legend>
        <label className="mr-4"><input type="radio" checked={enabled} onChange={() => setEnabled(true)} /> {t("inboundIntegrations.enable")}</label>
        <label><input type="radio" checked={!enabled} onChange={() => setEnabled(false)} /> {t("inboundIntegrations.disable")}</label>
      </fieldset>

      <label className="block">{t("inboundIntegrations.name")}
        <input className="mt-1 w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="block">{t("inboundIntegrations.description")}
        <input className="mt-1 w-full rounded border px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label className="block">{t("inboundIntegrations.selectAccount")}
        <select className="mt-1 w-full rounded border px-3 py-2" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      <div>
        <div className="font-medium">{t("inboundIntegrations.webhookUrl")}</div>
        <div className="mt-1 flex gap-2">
          <input className="w-full rounded border bg-gray-50 px-3 py-2 text-sm" readOnly value={initial.webhookUrl} />
          <button className="rounded bg-emerald-600 px-3 py-2 text-white" onClick={copyUrl}>{copied ? t("inboundIntegrations.copied") : t("inboundIntegrations.copy")}</button>
        </div>
        <p className="mt-1 text-xs text-gray-500">{t("inboundIntegrations.webhookHint")}</p>
        <button className="mt-2 rounded bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" onClick={capture} disabled={capturing}>
          {capturing ? t("inboundIntegrations.capturing") : t("inboundIntegrations.captureResponse")}
        </button>
      </div>

      <label className="block">{t("inboundIntegrations.recipientKey")}
        <input className="mt-1 w-full rounded border px-3 py-2" placeholder="billing.billing_phone" value={recipientPathKey} onChange={(e) => setRecipientPathKey(e.target.value)} />
        <span className="text-xs text-red-500">{t("inboundIntegrations.recipientKeyHint")}</span>
      </label>

      <div>
        <div className="font-medium">{t("inboundIntegrations.caption")}</div>
        <textarea ref={captionRef} className="mt-1 w-full rounded border px-3 py-2" rows={4} placeholder={t("inboundIntegrations.captionPlaceholder")} value={caption} onChange={(e) => setCaption(e.target.value)} />
        {paths.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {paths.map((p) => <button key={p} className="rounded bg-gray-100 px-2 py-1 text-xs" onClick={() => insertVar(p)}>{`{{${p}}}`}</button>)}
          </div>
        )}
      </div>

      <div>
        <div className="font-medium">{t("inboundIntegrations.sendTest")}</div>
        <div className="mt-1 flex gap-2">
          <input className="w-full rounded border px-3 py-2" placeholder={t("inboundIntegrations.testRecipient")} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="rounded border px-3 py-2" onClick={sendTest}>{t("inboundIntegrations.send")}</button>
        </div>
      </div>

      <div className="flex justify-between">
        <button className="rounded bg-gray-800 px-4 py-2 text-white" onClick={() => router.push(`/${workspaceSlug}/integrations/inbound`)}>{t("inboundIntegrations.back")}</button>
        <div className="flex gap-2">
          <button className="rounded border border-red-300 px-4 py-2 text-red-600" onClick={remove}>{t("inboundIntegrations.delete")}</button>
          <button className="rounded bg-emerald-600 px-4 py-2 text-white" onClick={save}>{t("inboundIntegrations.save")}</button>
        </div>
      </div>

      <div>
        <div className="font-medium">{t("inboundIntegrations.logs")}</div>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">{t("inboundIntegrations.logEmpty")}</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th>{t("inboundIntegrations.colWhen")}</th><th>{t("inboundIntegrations.colPhone")}</th><th>{t("inboundIntegrations.colStatus")}</th><th>{t("inboundIntegrations.colError")}</th>
            </tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td>{new Date(l.createdAt).toLocaleString()}</td><td>{l.resolvedPhone ?? "—"}</td><td>{l.status}</td><td className="text-red-600">{l.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] Add a nav link to the workspace sidebar. Locate the nav (search for an existing entry, e.g. `grep -rn "templates\|broadcasts" apps/web/src --include="*.tsx" | grep -i href`) and add an "Integrations" item pointing to `/${workspaceSlug}/integrations/inbound`. (If a generic `/integrations` hub page already exists from Plan 6.5, add the inbound link there as a card instead.)

- [ ] Typecheck + lint:

```bash
pnpm --filter @evo/web typecheck && pnpm --filter @evo/web lint
```

Expected: exit 0.

- [ ] **Commit:** `feat(web): inbound integrations list + editor UI + i18n`

---

### Task 8: e2e — Playwright roundtrip

**Files:**
- `apps/web/tests/e2e/inbound-integrations.spec.ts`

The e2e creates an integration via the API (authenticated session from the shared fixture), POSTs a sample JSON to the public `/integration_webhook/:token` on the ingest origin, then asserts the recipient resolved + a log row was written. It also tests the missing-recipient path. The actual WhatsApp send is not asserted (no live Evolution); we assert the log/queue side-effects.

- [ ] Write `apps/web/tests/e2e/inbound-integrations.spec.ts`. Reuse the existing e2e auth helpers (match the pattern of the other specs in `apps/web/tests/e2e/`; the snippet below assumes a `signInAndGetWorkspace` helper and an `INGEST_ORIGIN` — adapt to the repo's existing fixtures):

```ts
import { test, expect } from "@playwright/test";

const INGEST_ORIGIN = process.env.INGEST_ORIGIN ?? "http://localhost:4000";

test("inbound integration: create, receive, resolve recipient, log", async ({ page, request }) => {
  // 1. Sign in + reach a workspace (reuse existing helper from the suite).
  const { slug, instanceId } = await signInAndGetWorkspace(page); // existing helper

  // 2. Create the integration via the session-authed API.
  const createRes = await page.request.post(`/api/workspaces/${slug}/inbound-integrations`, {
    data: { instanceId, recipientPathKey: "billing.billing_phone", captionTemplate: "Hi {{billing.first_name}}", enabled: true },
  });
  expect(createRes.ok()).toBeTruthy();
  const { integration } = await createRes.json();
  const token = integration.webhookUrl.split("/").pop();

  // 3. POST a sample payload to the PUBLIC receiver (no auth, ingest origin).
  const hookRes = await request.post(`${INGEST_ORIGIN}/integration_webhook/${token}`, {
    data: { billing: { billing_phone: "+60 12-345 6789", first_name: "Aiman" } },
  });
  expect(hookRes.status()).toBe(200);

  // 4. Assert a log row resolved the recipient.
  await expect.poll(async () => {
    const logsRes = await page.request.get(`/api/workspaces/${slug}/inbound-integrations/${integration.id}/logs`);
    const { logs } = await logsRes.json();
    return logs[0]?.resolvedPhone ?? null;
  }).toBe("60123456789");

  // 5. Missing recipient -> 422 + no_recipient log.
  const bad = await request.post(`${INGEST_ORIGIN}/integration_webhook/${token}`, { data: { billing: {} } });
  expect(bad.status()).toBe(422);
  await expect.poll(async () => {
    const logsRes = await page.request.get(`/api/workspaces/${slug}/inbound-integrations/${integration.id}/logs`);
    const { logs } = await logsRes.json();
    return logs.some((l: any) => l.status === "no_recipient");
  }).toBe(true);
});
```

- [ ] Run the e2e (requires the full docker stack: web + ingest + worker + postgres + redis):

```bash
pnpm --filter @evo/web test:e2e -- inbound-integrations
```

Expected: the spec passes (recipient resolves to `60123456789`; missing-recipient yields a `no_recipient` log).

- [ ] **Commit:** `test(web): e2e inbound integration roundtrip`

---

### Task 9: Final review

- [ ] Run the full relevant test surface:

```bash
pnpm --filter @evo/inbound-templating test \
  && pnpm --filter @evo/ingest test \
  && pnpm --filter @evo/worker test \
  && pnpm --filter @evo/web typecheck
```

Expected: all green.

- [ ] Grep for leaked plaintext / consistency:

```bash
grep -rn "integration_webhook" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: the receiver route (ingest), the CRUD `webhookUrl` builders (web API + editor pages), and tests — all building from `WEBHOOK_PUBLIC_BASE_URL`. No hardcoded production hostnames.

- [ ] Verify `TENANTED_MODELS` includes both new models and that NO tenant-scoped query path is used in the public receiver (`apps/ingest/src/inbound.ts` must use raw `prisma`, never `tenantClient`):

```bash
grep -n "tenantClient\|prisma" apps/ingest/src/inbound.ts
```

Expected: only `prisma` (raw), no `tenantClient`.

- [ ] Confirm migration is committed and `schema.prisma` matches the migration:

```bash
pnpm --filter @evo/db exec prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Self-review checklist:**
  - [ ] Receiver is in `apps/ingest` (public surface) and uses raw `prisma` + derives `workspaceId` from the row.
  - [ ] Public endpoint: 404 unknown token, 200 no-op disabled, 422 no recipient, 413 oversize, 400 invalid JSON, 429 rate-limited, 200 on success — fast return.
  - [ ] `lastSamplePayload`/`lastReceivedAt` written on EVERY inbound (even disabled) so Capture Response works.
  - [ ] Send goes through the BullMQ `inbound-send` queue → `inboundSendProcessor` → `sendViaInstance` (with retries); test endpoint sends synchronously.
  - [ ] Field/type names match the naming contract across schema, ingest, worker, API, UI.
  - [ ] Both new models in `TENANTED_MODELS`; all web reads/writes go through `tenantClient`.
  - [ ] Writes require `Admin`; reads allow `Viewer`.
  - [ ] `mediaAssetId` column exists; media UI/send gated behind Plan 7 with graceful text-only fallback.
  - [ ] All unit tests assert real outcomes (paths, render output, phone normalisation, log status transitions).

- [ ] **Commit:** `chore: plan 10 final review`

---

## Self-review checklist (plan-level)

- [ ] ~9 bite-sized TDD tasks, each ending in a commit.
- [ ] Every task has **Files:** blocks + complete, copy-pasteable code (no placeholders) + real commands with expected output.
- [ ] Receiver placement (`apps/ingest`) justified; security model (token auth, size cap, rate limit, no payload reflection) documented in the header.
- [ ] Capture Response mechanism (always-store sample + arm/poll on `lastReceivedAt` advance) documented and implemented.
- [ ] Naming contract is consistent across all tasks.
- [ ] Plan 7 (MediaPicker) called out as an optional dependency with graceful degradation.
