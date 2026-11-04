# Plan 6.5 — Integrations, audit viewer, API keys, AI keys, groups, webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the long-tail gaps from the original spec that earlier plans deferred: a read-only audit log viewer, developer API keys, per-workspace AI provider keys (so the chatbot can use a workspace-specific Anthropic key instead of the global env), a pass-through configurator for Chatwoot (which proves the pattern for the other Evolution integrations later), a read-only groups list, and outbound webhook subscriptions.

**Architecture:** Three new tables: `ApiKey` (hashed token, scopes, last-used timestamp), `WebhookSubscription` (per-workspace HTTPS outbound subscriptions with HMAC secret), and `WorkspaceAiKey` (workspace-scoped AI provider credentials, AES-encrypted at rest). The audit viewer is a single page over the existing `AuditLog` rows. The Chatwoot configurator is a thin form that POSTs to Evolution's `/chatwoot/set/<name>` via the existing `@evo/evolution-client` (extended with a new `IntegrationApi`). Groups also extend `@evo/evolution-client` with read methods. Webhook subscription delivery (the worker job that actually POSTs payloads to subscribers) is wired here but defers per-event fan-out integration to a small follow-up because it needs every existing event source to call the new `notifySubscribers` helper. For now the worker has the queue + processor, and the inbox webhook is the one event source that publishes — broadcasts/warmer can be added in a follow-up commit.

**Tech Stack:** Inherits Plans 0–6. Adds: nothing external — `node:crypto` provides argon2-equivalent hashing for API keys via existing `argon2` lib; AES encryption uses `node:crypto`.

**Definition of done:**
1. `/settings/audit` shows last 200 audit rows for the workspace, filterable by action.
2. `/settings/api-keys` lets admins create developer API keys (token shown once on create), list, delete. Tokens hashed with argon2id, never stored in cleartext.
3. `/settings/webhooks` lets admins register outbound webhook subscriptions (URL + HMAC secret + event types).
4. `/settings/integrations/ai` lets admins set a workspace-specific Anthropic API key; if present, the chatbot uses it instead of `process.env.ANTHROPIC_API_KEY`.
5. `/settings/integrations/chatwoot` lets admins configure the Chatwoot pass-through per instance; form POSTs to Evolution's `/chatwoot/set/<name>`.
6. `/[workspaceSlug]/groups` lists WhatsApp groups per instance (read-only, fetched live from Evolution).
7. All previous tests pass; new tests added: api-keys helper 3+, ai-keys helper 3+, evolution-client integration/groups 2+.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — section 1 (ApiKey, WebhookSubscription tables), section 2 (Settings → Audit/API keys/Webhooks/Integrations + Groups screens), section 4 (group + integrations endpoints in `@evo/evolution-client`).

---

## File structure produced by this plan

```
/
├─ packages/
│  ├─ db/prisma/schema.prisma                                       # MODIFIED: + ApiKey, WebhookSubscription, WorkspaceAiKey, WorkspaceIntegration
│  ├─ db/prisma/migrations/<ts>_keys_webhooks/migration.sql         # NEW
│  ├─ db/src/tenant.ts                                              # MODIFIED: + 4 new entries
│  └─ evolution-client/src/
│     ├─ integration.ts                                             # NEW: IntegrationApi.chatwootSet
│     ├─ integration.test.ts                                        # NEW
│     ├─ groups.ts                                                  # NEW: GroupsApi.fetchAll
│     ├─ groups.test.ts                                             # NEW
│     └─ index.ts                                                   # MODIFIED: export
├─ apps/web/
│  ├─ messages/en-GB.json                                           # MODIFIED: audit.* apiKeys.* webhooks.* aiKeys.* integrations.* groups.*
│  └─ src/
│     ├─ lib/
│     │  ├─ encrypt.ts                                              # NEW: small AES-GCM helper
│     │  ├─ encrypt.test.ts                                         # NEW
│     │  └─ ai-key.ts                                               # NEW: resolveAiKey(workspaceId, provider)
│     └─ app/
│        ├─ api/workspaces/[slug]/
│        │  ├─ api-keys/route.ts                                    # GET, POST (token returned once)
│        │  ├─ api-keys/[id]/route.ts                               # DELETE
│        │  ├─ webhooks/route.ts                                    # GET, POST
│        │  ├─ webhooks/[id]/route.ts                               # PUT, DELETE
│        │  ├─ ai-keys/route.ts                                     # GET (masked), PUT (upsert), DELETE
│        │  ├─ integrations/chatwoot/route.ts                       # GET (resolved status), POST (configure per instance)
│        │  └─ groups/route.ts                                      # GET (live from Evolution)
│        └─ [workspaceSlug]/settings/
│           ├─ audit/page.tsx                                       # server-rendered list
│           ├─ api-keys/page.tsx
│           ├─ api-keys/keys-form.tsx                               # client
│           ├─ webhooks/page.tsx
│           ├─ webhooks/webhooks-form.tsx                           # client
│           └─ integrations/
│              ├─ page.tsx                                          # hub
│              ├─ ai/page.tsx                                       # AI provider keys
│              ├─ ai/ai-form.tsx
│              ├─ chatwoot/page.tsx
│              └─ chatwoot/chatwoot-form.tsx
│        └─ [workspaceSlug]/groups/page.tsx                         # read-only groups list
├─ apps/ingest/src/automate.ts                                      # MODIFIED: prefer workspace AI key over env
└─ tests/e2e/                                                       # (no new e2e in this plan — unit tests cover; see review)
```

Tasks below build this in order.

---

### Task 1: Schema — ApiKey, WebhookSubscription, WorkspaceAiKey, WorkspaceIntegration

**Files:** modify schema, new migration, modify tenant.

- [ ] **Step 1: Append to `packages/db/prisma/schema.prisma`** (after the Plan 6 models):

```prisma
enum AiProvider {
  claude
  openai
}

enum IntegrationKind {
  chatwoot
  typebot
  rabbitmq
  sqs
  kafka
  pusher
}

model ApiKey {
  id              String    @id @default(cuid())
  workspaceId     String
  name            String
  hashedKey       String
  scopes          Json
  lastUsedAt      DateTime?
  createdByUserId String
  createdAt       DateTime  @default(now())
  revokedAt       DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([hashedKey])
}

model WebhookSubscription {
  id          String   @id @default(cuid())
  workspaceId String
  url         String
  secret      String
  events      Json
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, enabled])
}

model WorkspaceAiKey {
  workspaceId    String     @id
  provider       AiProvider
  encryptedKey   String
  defaultModel   String?
  updatedAt      DateTime   @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

model WorkspaceIntegration {
  id          String          @id @default(cuid())
  workspaceId String
  instanceId  String?
  kind        IntegrationKind
  config      Json
  enabled     Boolean         @default(true)
  updatedAt   DateTime        @updatedAt

  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance?  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, instanceId, kind])
  @@index([workspaceId, kind])
}
```

Add to `Workspace` relations:

```prisma
  apiKeys              ApiKey[]
  webhookSubscriptions WebhookSubscription[]
  aiKey                WorkspaceAiKey?
  integrations         WorkspaceIntegration[]
```

Add to `Instance` relations:

```prisma
  integrations WorkspaceIntegration[]
```

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @evo/db exec prisma migrate dev --name keys_webhooks
```

Verify 14-digit `_keys_webhooks/` directory.

- [ ] **Step 3: Extend tenant scope**

In `packages/db/src/tenant.ts`, add 4 new entries:

```typescript
  "ApiKey",
  "WebhookSubscription",
  "WorkspaceAiKey",
  "WorkspaceIntegration",
```

TENANTED_MODELS should now have 28 entries.

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
git commit -m "feat(db): ApiKey, WebhookSubscription, WorkspaceAiKey, WorkspaceIntegration tables"
```

---

### Task 2: `encrypt.ts` helper + `ai-key.ts` resolver (TDD)

**Files:**
- New: `apps/web/src/lib/encrypt.ts`
- Test: `apps/web/src/lib/encrypt.test.ts`
- New: `apps/web/src/lib/ai-key.ts`

- [ ] **Step 1: Failing test for encrypt**

`apps/web/src/lib/encrypt.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt } from "./encrypt";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "f".repeat(64); // 32 bytes hex
});

describe("encrypt/decrypt", () => {
  it("round-trips a string", async () => {
    const cipher = await encrypt("hello world");
    expect(cipher).not.toBe("hello world");
    const plain = await decrypt(cipher);
    expect(plain).toBe("hello world");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const a = await encrypt("same");
    const b = await encrypt("same");
    expect(a).not.toBe(b);
  });

  it("throws if ENCRYPTION_KEY is missing", async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(encrypt("x")).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
```

Run, verify FAIL.

- [ ] **Step 2: Implement `encrypt.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error("ENCRYPTION_KEY not set");
  if (hex.length !== 64) throw new Error("ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  return Buffer.from(hex, "hex");
}

export async function encrypt(plain: string): Promise<string> {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export async function decrypt(payload: string): Promise<string> {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const enc = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 3: `ai-key.ts`**

```typescript
import { prisma } from "@evo/db";
import { decrypt } from "./encrypt";

export async function resolveAiKey(workspaceId: string, provider: "claude" | "openai"): Promise<string | null> {
  const row = await prisma.workspaceAiKey.findUnique({ where: { workspaceId } });
  if (row && row.provider === provider) {
    try {
      return await decrypt(row.encryptedKey);
    } catch {
      return null;
    }
  }
  if (provider === "claude") return process.env.ANTHROPIC_API_KEY ?? null;
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? null;
  return null;
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @evo/web test
pnpm --filter @evo/web typecheck
```

Expected: 3 new tests passing; existing 17 still passing.

```bash
git add apps/web/src/lib/encrypt.ts apps/web/src/lib/encrypt.test.ts apps/web/src/lib/ai-key.ts
git commit -m "feat(web): AES-GCM encrypt/decrypt + resolveAiKey helper"
```

Also update `.env.example` to mention ENCRYPTION_KEY:

```
ENCRYPTION_KEY="64-char-hex-string-32-bytes-generated-with-openssl-rand-hex-32"
```

Generate one and put it in `.env` locally (NOT committed). Same key must be set in production via env.

```bash
git add .env.example
git commit --amend --no-edit
```

---

### Task 3: Audit log viewer page

**Files:**
- New: `apps/web/src/app/[workspaceSlug]/settings/audit/page.tsx`
- New: `apps/web/src/app/api/workspaces/[slug]/audit/route.ts`
- Modify: `apps/web/messages/en-GB.json`

- [ ] **Step 1: i18n**

```json
  "audit": {
    "title": "Audit log",
    "filter": "Filter by action",
    "noEvents": "No audit events yet",
    "action": "Action",
    "target": "Target",
    "user": "User",
    "when": "When"
  },
```

- [ ] **Step 2: API**

`apps/web/src/app/api/workspaces/[slug]/audit/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action")?.trim();
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const events = await db.auditLog.findMany({
      where: action ? { action: { contains: action } } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ events });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Page**

`apps/web/src/app/[workspaceSlug]/settings/audit/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";

export default async function AuditPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const events = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("audit.title")}</h1>
      {events.length === 0 ? (
        <p className="text-gray-500 text-sm">{t("audit.noEvents")}</p>
      ) : (
        <table className="w-full text-sm border rounded">
          <thead className="bg-gray-50">
            <tr><th className="p-2 text-left">{t("audit.when")}</th><th className="p-2 text-left">{t("audit.action")}</th><th className="p-2 text-left">{t("audit.target")}</th><th className="p-2 text-left">{t("audit.user")}</th></tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="p-2 text-xs">{e.createdAt.toLocaleString("en-GB")}</td>
                <td className="p-2 font-mono text-xs">{e.action}</td>
                <td className="p-2 font-mono text-xs">{e.target}</td>
                <td className="p-2 text-xs">{e.userId ?? "system"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/audit" "apps/web/src/app/[workspaceSlug]/settings/audit" apps/web/messages/en-GB.json
git commit -m "feat(web): audit log viewer (settings/audit)"
```

---

### Task 4: API keys CRUD

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/api-keys/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/api-keys/[id]/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/settings/api-keys/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/settings/api-keys/keys-form.tsx`

- [ ] **Step 1: i18n**

```json
  "apiKeys": {
    "title": "Developer API keys",
    "create": "Create key",
    "name": "Name",
    "newKeyShown": "Copy this key now — it will not be shown again.",
    "delete": "Revoke",
    "lastUsed": "Last used",
    "never": "Never"
  },
```

- [ ] **Step 2: API list/create**

`apps/web/src/app/api/workspaces/[slug]/api-keys/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError } from "@evo/shared";

const schema = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string()).optional() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const keys = await db.apiKey.findMany({
      where: { revokedAt: null },
      select: { id: true, name: true, scopes: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ keys });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const token = "ek_" + randomBytes(24).toString("base64url");
    const hashed = await argon2.hash(token, { type: argon2.argon2id });
    const db = tenantClient(workspace.id);
    const key = await db.apiKey.create({
      data: {
        name: parsed.data.name,
        hashedKey: hashed,
        scopes: parsed.data.scopes ?? [],
        createdByUserId: userId,
      } as any,
    });
    await writeAudit({
      workspaceId: workspace.id, userId,
      action: "apikey.created", target: `apikey:${key.id}`,
    });
    return NextResponse.json({ id: key.id, name: key.name, token }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: API revoke (DELETE)**

`apps/web/src/app/api/workspaces/[slug]/api-keys/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Key not found");
    await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit({ workspaceId: workspace.id, userId, action: "apikey.revoked", target: `apikey:${id}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: Page + client form**

`apps/web/src/app/[workspaceSlug]/settings/api-keys/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import KeysForm from "./keys-form";

export default async function ApiKeysPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const keys = await db.apiKey.findMany({
    where: { revokedAt: null },
    select: { id: true, name: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("apiKeys.title")}</h1>
      <KeysForm workspaceSlug={workspaceSlug} initial={keys.map((k) => ({ id: k.id, name: k.name, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/api-keys/keys-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Key = { id: string; name: string; lastUsedAt: string | null; createdAt: string };

export default function KeysForm({ workspaceSlug, initial }: { workspaceSlug: string; initial: Key[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/api-keys`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (res.ok) {
      const { id, name: keyName, token } = await res.json();
      setItems((x) => [{ id, name: keyName, lastUsedAt: null, createdAt: new Date().toISOString() }, ...x]);
      setToken(token);
      setName("");
      router.refresh();
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/api-keys/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex gap-2 items-end border rounded p-3">
        <input className="flex-1 border rounded p-2" placeholder={t("apiKeys.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("apiKeys.create")}</button>
      </form>
      {token && (
        <div className="border-2 border-yellow-400 bg-yellow-50 rounded p-3 space-y-2">
          <p className="text-sm font-semibold">{t("apiKeys.newKeyShown")}</p>
          <code className="block bg-white border rounded p-2 text-xs break-all">{token}</code>
          <button onClick={() => setToken(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}
      <ul className="border rounded divide-y">
        {items.map((k) => (
          <li key={k.id} className="p-3 flex justify-between text-sm">
            <span><strong>{k.name}</strong> <span className="text-xs text-gray-500">· {t("apiKeys.lastUsed")}: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-GB") : t("apiKeys.never")}</span></span>
            <button onClick={() => revoke(k.id)} className="text-red-600 text-xs underline">{t("apiKeys.delete")}</button>
          </li>
        ))}
        {items.length === 0 && <li className="p-3 text-gray-500 text-sm">—</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/api-keys" "apps/web/src/app/[workspaceSlug]/settings/api-keys" apps/web/messages/en-GB.json
git commit -m "feat(web): developer API keys CRUD (token shown once, hashed in DB)"
```

---

### Task 5: Workspace AI keys + wire into ingest automate

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/ai-keys/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/settings/integrations/ai/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/settings/integrations/ai/ai-form.tsx`
- Modify: `apps/ingest/src/automate.ts` (use resolveAiKey)
- Modify: `apps/ingest/package.json` (depends on the new helper — but it's in @evo/web/src/lib so we need to extract to a shared package OR inline the lookup in the ingest)

Actually for Plan 6.5 simplicity: the ingest does NOT import from `@evo/web`. Instead, the ingest queries `WorkspaceAiKey` directly and decrypts using `@evo/db` + a tiny inline crypto helper. Keep the existing env fallback.

- [ ] **Step 1: i18n**

```json
  "aiKeys": {
    "title": "AI provider keys",
    "providerLabel": "Provider",
    "providerClaude": "Claude (Anthropic)",
    "keyLabel": "API key",
    "save": "Save",
    "remove": "Remove",
    "stored": "Key stored. The bot will use this instead of the server-wide key.",
    "noKey": "No workspace key set; the server-wide key (if any) is used."
  },
```

- [ ] **Step 2: API** — `ai-keys/route.ts`

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { encrypt } from "@/lib/encrypt";
import { AppError } from "@evo/shared";

const schema = z.object({
  provider: z.enum(["claude", "openai"]),
  apiKey: z.string().min(10).max(500),
  defaultModel: z.string().max(80).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const row = await db.workspaceAiKey.findUnique({ where: { workspaceId: workspace.id } });
    return NextResponse.json({ key: row ? { provider: row.provider, defaultModel: row.defaultModel, hasKey: true } : null });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const enc = await encrypt(parsed.data.apiKey);
    const db = tenantClient(workspace.id);
    await db.workspaceAiKey.upsert({
      where: { workspaceId: workspace.id },
      create: { provider: parsed.data.provider, encryptedKey: enc, defaultModel: parsed.data.defaultModel } as any,
      update: { provider: parsed.data.provider, encryptedKey: enc, defaultModel: parsed.data.defaultModel },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    await db.workspaceAiKey.deleteMany({ where: { workspaceId: workspace.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Page + form**

`apps/web/src/app/[workspaceSlug]/settings/integrations/ai/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import AiForm from "./ai-form";

export default async function AiKeysPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const row = await db.workspaceAiKey.findUnique({ where: { workspaceId: workspace.id } });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("aiKeys.title")}</h1>
      <AiForm workspaceSlug={workspaceSlug} initial={row ? { provider: row.provider, defaultModel: row.defaultModel ?? "" } : null} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/integrations/ai/ai-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Initial = { provider: string; defaultModel: string } | null;

export default function AiForm({ workspaceSlug, initial }: { workspaceSlug: string; initial: Initial }) {
  const t = useTranslations();
  const router = useRouter();
  const [provider, setProvider] = useState(initial?.provider ?? "claude");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? "claude-haiku-4-5-20251001");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-keys`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, defaultModel }),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback(t("aiKeys.stored"));
      setApiKey("");
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm("Remove the workspace AI key?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/ai-keys`, { method: "DELETE" });
    setFeedback(null);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3 border rounded p-4">
      {initial ? (
        <p className="text-xs text-green-700">{t("aiKeys.stored")}</p>
      ) : (
        <p className="text-xs text-gray-600">{t("aiKeys.noKey")}</p>
      )}
      <label className="block">
        <span className="text-sm">{t("aiKeys.providerLabel")}</span>
        <select className="w-full border rounded p-2 mt-1" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="claude">{t("aiKeys.providerClaude")}</option>
        </select>
      </label>
      <label className="block">
        <span className="text-sm">{t("aiKeys.keyLabel")}</span>
        <input type="password" className="w-full border rounded p-2 mt-1" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-…" />
      </label>
      <label className="block">
        <span className="text-sm">Default model</span>
        <input className="w-full border rounded p-2 mt-1" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button disabled={busy || !apiKey} className="bg-black text-white rounded p-2 px-4 disabled:opacity-50">{t("aiKeys.save")}</button>
        {initial && <button type="button" onClick={remove} className="border rounded p-2 px-4 text-red-600">{t("aiKeys.remove")}</button>}
      </div>
      {feedback && <p className="text-sm text-green-700">{feedback}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Wire into ingest automate**

`apps/ingest/src/automate.ts` currently calls `claudeReply(...)` which uses `process.env.ANTHROPIC_API_KEY` via `@evo/ai`. To use per-workspace keys, modify the automate function to RESOLVE the key first via a DB lookup + decrypt and pass it through.

Since the ingest is a separate process from the web app, the encrypt/decrypt helpers from `@evo/web` can't be imported directly. Move them into a new tiny shared package OR inline a copy in the ingest.

Simplest approach: extract `apps/web/src/lib/encrypt.ts` into `packages/crypto/` as a tiny package. THEN have both web and ingest import from it.

**Detailed steps:**

(a) Create `packages/crypto/`:

`packages/crypto/package.json`:

```json
{
  "name": "@evo/crypto",
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

`packages/crypto/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }
```

`packages/crypto/src/index.ts`: copy the contents of `apps/web/src/lib/encrypt.ts` here.

(b) Update `apps/web/src/lib/encrypt.ts` to re-export from `@evo/crypto`:

```typescript
export { encrypt, decrypt } from "@evo/crypto";
```

(c) Add `@evo/crypto` to `apps/web/package.json` and `apps/ingest/package.json` dependencies, then `pnpm install`.

(d) Update `apps/ingest/src/automate.ts`:

```typescript
import { sendViaInstance } from "@evo/send";
import { claudeReply } from "@evo/ai";
import { decrypt } from "@evo/crypto";

// ...

async function resolveWorkspaceAiKey(workspaceId: string, provider: string): Promise<string | null> {
  const { prisma } = await import("@evo/db");
  const row = await prisma.workspaceAiKey.findUnique({ where: { workspaceId } });
  if (row && row.provider === provider) {
    try { return await decrypt(row.encryptedKey); } catch { return null; }
  }
  if (provider === "claude") return process.env.ANTHROPIC_API_KEY ?? null;
  if (provider === "openai") return process.env.OPENAI_API_KEY ?? null;
  return null;
}
```

Then in the existing automate function, just before the `claudeReply(...)` call, resolve the key and pass it (claudeReply currently reads from env directly). Since `claudeReply` is in `@evo/ai` and reads env directly, we'd need to extend `claudeReply` to accept an optional `apiKey` override.

Modify `packages/ai/src/index.ts`:

```typescript
export interface ClaudeReplyInput {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  apiKey?: string; // NEW
}

export async function claudeReply(input: ClaudeReplyInput): Promise<string> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  // ...rest unchanged
```

Then in `automate.ts`, after resolving the workspace key:

```typescript
  const apiKey = await resolveWorkspaceAiKey(input.workspaceId, "claude");
  try {
    reply = await claudeReply({
      model: chatbot.fallbackModel,
      systemPrompt: chatbot.systemPrompt ?? "You are a helpful customer service assistant.",
      messages: context.length ? context : [{ role: "user", content: text }],
      apiKey: apiKey ?? undefined,
    });
  } catch {
    return;
  }
```

Update the `claudeReply` test in `packages/ai/src/index.test.ts` to add 1 test that overrides the env via `input.apiKey`:

```typescript
  it("uses input.apiKey when provided, overriding env", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    createMock.mockResolvedValue({ content: [{ type: "text", text: "Hi!" }] });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
      apiKey: "override-key",
    });
    expect(reply).toBe("Hi!");
  });
```

Re-run `pnpm --filter @evo/ai test` — expect 4/4.

- [ ] **Step 5: typecheck + commit**

```bash
pnpm install
pnpm --filter @evo/web typecheck
pnpm --filter @evo/ingest typecheck
pnpm --filter @evo/ai test
git add packages/crypto packages/ai apps/web apps/ingest pnpm-lock.yaml
git commit -m "feat(ai,web,ingest): per-workspace AI keys (encrypted, decrypts at use) with @evo/crypto package"
```

---

### Task 6: Chatwoot integration configurator + `@evo/evolution-client` IntegrationApi

**Files:**
- New: `packages/evolution-client/src/integration.ts`
- Test: `packages/evolution-client/src/integration.test.ts`
- Modify: `packages/evolution-client/src/index.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/integrations/chatwoot/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/settings/integrations/page.tsx` (hub)
- New: `apps/web/src/app/[workspaceSlug]/settings/integrations/chatwoot/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/settings/integrations/chatwoot/chatwoot-form.tsx`

- [ ] **Step 1: `integration.ts` + test (TDD)**

`packages/evolution-client/src/integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { IntegrationApi } from "./integration";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("IntegrationApi.chatwootSet", () => {
  it("posts to /chatwoot/set/<name> with config", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = new IntegrationApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.chatwootSet("inst-1", {
      enabled: true,
      accountId: "1",
      token: "chatwoot-token",
      url: "https://chatwoot.example.com",
      nameInbox: "WhatsApp",
      signMsg: true,
      reopenConversation: true,
      conversationPending: false,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chatwoot/set/inst-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).enabled).toBe(true);
  });
});
```

`packages/evolution-client/src/integration.ts`:

```typescript
import type { EvolutionClient } from "./client";

export interface ChatwootConfig {
  enabled: boolean;
  accountId: string;
  token: string;
  url: string;
  nameInbox?: string;
  signMsg?: boolean;
  reopenConversation?: boolean;
  conversationPending?: boolean;
}

export class IntegrationApi {
  constructor(private readonly client: EvolutionClient) {}

  async chatwootSet(instanceName: string, config: ChatwootConfig): Promise<void> {
    await this.client.request("POST", `/chatwoot/set/${encodeURIComponent(instanceName)}`, config);
  }

  async chatwootFind(instanceName: string): Promise<unknown> {
    return this.client.request("GET", `/chatwoot/find/${encodeURIComponent(instanceName)}`);
  }
}
```

Update `packages/evolution-client/src/index.ts` to export.

Run + commit.

- [ ] **Step 2: Web API route** — `chatwoot/route.ts`

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, IntegrationApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  instanceId: z.string(),
  enabled: z.boolean(),
  accountId: z.string().min(1),
  token: z.string().min(1),
  url: z.string().url(),
  nameInbox: z.string().optional(),
  signMsg: z.boolean().optional(),
  reopenConversation: z.boolean().optional(),
  conversationPending: z.boolean().optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const row = await db.workspaceIntegration.findUnique({
      where: { workspaceId_instanceId_kind: { workspaceId: workspace.id, instanceId, kind: "chatwoot" } } as any,
    });
    return NextResponse.json({ config: row?.config ?? null, enabled: row?.enabled ?? false });
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
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new IntegrationApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
    await api.chatwootSet(instance.evolutionInstanceName, parsed.data);

    await db.workspaceIntegration.upsert({
      where: { workspaceId_instanceId_kind: { workspaceId: workspace.id, instanceId: parsed.data.instanceId, kind: "chatwoot" } } as any,
      create: {
        instanceId: parsed.data.instanceId,
        kind: "chatwoot",
        config: parsed.data as any,
        enabled: parsed.data.enabled,
      } as any,
      update: { config: parsed.data as any, enabled: parsed.data.enabled },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Integrations hub + Chatwoot pages**

`apps/web/src/app/[workspaceSlug]/settings/integrations/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";

export default async function IntegrationsHub({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("integrations.title")}</h1>
      <ul className="space-y-2">
        <li><Link href={`/${workspaceSlug}/settings/integrations/ai`} className="block border rounded p-3 hover:bg-gray-50">AI provider keys</Link></li>
        <li><Link href={`/${workspaceSlug}/settings/integrations/chatwoot`} className="block border rounded p-3 hover:bg-gray-50">Chatwoot (pass-through)</Link></li>
      </ul>
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/integrations/chatwoot/page.tsx`:

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import ChatwootForm from "./chatwoot-form";

export default async function ChatwootPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ select: { id: true, label: true } });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Chatwoot</h1>
      <ChatwootForm workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/integrations/chatwoot/chatwoot-form.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

type Instance = { id: string; label: string };

export default function ChatwootForm({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [enabled, setEnabled] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    fetch(`/api/workspaces/${workspaceSlug}/integrations/chatwoot?instanceId=${instanceId}`).then(async (r) => {
      if (r.ok) {
        const { config, enabled } = await r.json();
        if (config) {
          setEnabled(Boolean(enabled));
          setAccountId(String(config.accountId ?? ""));
          setToken(String(config.token ?? ""));
          setUrl(String(config.url ?? ""));
        }
      }
    });
  }, [workspaceSlug, instanceId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/integrations/chatwoot`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, enabled, accountId, token, url, signMsg: true, reopenConversation: true }),
    });
    setBusy(false);
    setFeedback(res.ok ? "Saved" : "Failed");
  }

  return (
    <form onSubmit={save} className="space-y-3 border rounded p-4">
      <label className="block">
        <span className="text-sm">Instance</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      <label className="block"><span className="text-sm">Account ID</span><input className="w-full border rounded p-2 mt-1" value={accountId} onChange={(e) => setAccountId(e.target.value)} required /></label>
      <label className="block"><span className="text-sm">Token</span><input type="password" className="w-full border rounded p-2 mt-1" value={token} onChange={(e) => setToken(e.target.value)} required /></label>
      <label className="block"><span className="text-sm">Chatwoot URL</span><input className="w-full border rounded p-2 mt-1" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://app.chatwoot.com" /></label>
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">Save</button>
      {feedback && <p className="text-sm">{feedback}</p>}
    </form>
  );
}
```

- [ ] **Step 4: i18n + commit**

Add to `en-GB.json`:

```json
  "integrations": {
    "title": "Integrations"
  },
```

```bash
pnpm --filter @evo/web typecheck
pnpm --filter @evo/evolution-client test
git add packages/evolution-client apps/web/messages/en-GB.json "apps/web/src/app/api/workspaces/[slug]/integrations" "apps/web/src/app/[workspaceSlug]/settings/integrations"
git commit -m "feat(web,evolution-client): Chatwoot pass-through configurator + IntegrationApi"
```

---

### Task 7: Webhook subscriptions CRUD

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/webhooks/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/webhooks/[id]/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/settings/webhooks/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/settings/webhooks/webhooks-form.tsx`

- [ ] **Step 1: API list/create**

`apps/web/src/app/api/workspaces/[slug]/webhooks/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const schema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().optional().default(true),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const subs = await db.webhookSubscription.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ subs });
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
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const secret = randomBytes(24).toString("base64url");
    const db = tenantClient(workspace.id);
    const sub = await db.webhookSubscription.create({
      data: { url: parsed.data.url, secret, events: parsed.data.events as any, enabled: parsed.data.enabled } as any,
    });
    return NextResponse.json({ sub: { id: sub.id, url: sub.url, events: sub.events, enabled: sub.enabled, secret } }, { status: 201 });
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

const schema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.webhookSubscription.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Subscription not found");
    const sub = await db.webhookSubscription.update({ where: { id }, data: { ...parsed.data, events: parsed.data.events as any } });
    return NextResponse.json({ sub });
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
    await db.webhookSubscription.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: UI page + form**

`apps/web/src/app/[workspaceSlug]/settings/webhooks/page.tsx`:

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import WebhooksForm from "./webhooks-form";

export default async function WebhooksPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const subs = await db.webhookSubscription.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Webhooks</h1>
      <WebhooksForm
        workspaceSlug={workspaceSlug}
        initial={subs.map((s) => ({ id: s.id, url: s.url, events: s.events as string[], enabled: s.enabled, secretMasked: s.secret.slice(0, 6) + "…" }))}
      />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/webhooks/webhooks-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Sub = { id: string; url: string; events: string[]; enabled: boolean; secretMasked: string };

const EVENTS = [
  "message.inbound", "message.outbound", "message.status",
  "broadcast.completed", "instance.connection.changed",
];

export default function WebhooksForm({ workspaceSlug, initial }: { workspaceSlug: string; initial: Sub[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function toggle(ev: string) {
    setSelected((s) => s.includes(ev) ? s.filter((e) => e !== ev) : [...s, ev]);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/webhooks`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, events: selected }),
    });
    setBusy(false);
    if (res.ok) {
      const { sub } = await res.json();
      setItems((arr) => [{ id: sub.id, url: sub.url, events: sub.events, enabled: sub.enabled, secretMasked: sub.secret.slice(0, 6) + "…" }, ...arr]);
      setSecret(sub.secret);
      setUrl(""); setSelected([]);
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/webhooks/${id}`, { method: "DELETE" });
    setItems((arr) => arr.filter((s) => s.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="border rounded p-3 space-y-2">
        <input className="w-full border rounded p-2" placeholder="https://example.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <div className="flex flex-wrap gap-2 text-xs">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-1">
              <input type="checkbox" checked={selected.includes(ev)} onChange={() => toggle(ev)} />
              {ev}
            </label>
          ))}
        </div>
        <button disabled={busy || selected.length === 0} className="bg-black text-white rounded p-2 px-4 disabled:opacity-50">Add</button>
      </form>
      {secret && (
        <div className="border-2 border-yellow-400 bg-yellow-50 rounded p-3 space-y-2">
          <p className="text-sm font-semibold">Copy this signing secret now — it will not be shown again.</p>
          <code className="block bg-white border rounded p-2 text-xs break-all">{secret}</code>
          <button onClick={() => setSecret(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}
      <ul className="border rounded divide-y">
        {items.map((s) => (
          <li key={s.id} className="p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span><strong>{s.url}</strong> {!s.enabled && <em className="text-gray-500">(disabled)</em>}</span>
              <button onClick={() => remove(s.id)} className="text-red-600 text-xs underline">Delete</button>
            </div>
            <div className="text-xs text-gray-600">Events: {s.events.join(", ")} · Secret: <code>{s.secretMasked}</code></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/webhooks" "apps/web/src/app/[workspaceSlug]/settings/webhooks"
git commit -m "feat(web): webhook subscriptions CRUD (HMAC secret shown once on create)"
```

---

### Task 8: Groups (read-only)

**Files:**
- New: `packages/evolution-client/src/groups.ts`
- Test: `packages/evolution-client/src/groups.test.ts`
- Modify: `packages/evolution-client/src/index.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/groups/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/groups/page.tsx`

- [ ] **Step 1: groups.ts + test (TDD)**

`packages/evolution-client/src/groups.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { GroupsApi } from "./groups";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("GroupsApi.fetchAll", () => {
  it("returns the array of groups", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { id: "g1@g.us", subject: "Team", size: 12 },
      { id: "g2@g.us", subject: "Friends", size: 4 },
    ]), { status: 200 }));
    const api = new GroupsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    const groups = await api.fetchAll("inst-1");
    expect(groups).toHaveLength(2);
    expect(groups[0].subject).toBe("Team");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/group/fetchAllGroups/inst-1");
  });
});
```

`packages/evolution-client/src/groups.ts`:

```typescript
import type { EvolutionClient } from "./client";

export interface WhatsappGroup {
  id: string;
  subject: string;
  size: number;
  owner?: string;
  desc?: string;
}

export class GroupsApi {
  constructor(private readonly client: EvolutionClient) {}

  async fetchAll(instanceName: string): Promise<WhatsappGroup[]> {
    const raw = await this.client.request<unknown>("GET", `/group/fetchAllGroups/${encodeURIComponent(instanceName)}`);
    if (!Array.isArray(raw)) return [];
    return raw as WhatsappGroup[];
  }
}
```

Update `index.ts` to export.

- [ ] **Step 2: Web API route**

`apps/web/src/app/api/workspaces/[slug]/groups/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, GroupsApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new GroupsApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
    try {
      const groups = await api.fetchAll(instance.evolutionInstanceName);
      return NextResponse.json({ groups });
    } catch {
      return NextResponse.json({ groups: [] });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Groups page**

`apps/web/src/app/[workspaceSlug]/groups/page.tsx`:

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import GroupsList from "./groups-list";

export default async function GroupsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ select: { id: true, label: true } });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Groups</h1>
      <GroupsList workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/groups/groups-list.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";

type Group = { id: string; subject: string; size: number };

export default function GroupsList({ workspaceSlug, instances }: { workspaceSlug: string; instances: { id: string; label: string }[] }) {
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!instanceId) return;
    setBusy(true);
    fetch(`/api/workspaces/${workspaceSlug}/groups?instanceId=${instanceId}`).then(async (r) => {
      if (r.ok) {
        const { groups } = await r.json();
        setGroups(groups ?? []);
      }
      setBusy(false);
    });
  }, [workspaceSlug, instanceId]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm">Instance</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      {busy && <p className="text-gray-500 text-sm">Loading…</p>}
      <ul className="border rounded divide-y">
        {groups.map((g) => (
          <li key={g.id} className="p-3 flex justify-between text-sm">
            <span><strong>{g.subject}</strong></span>
            <span className="text-gray-500">{g.size} members</span>
          </li>
        ))}
        {!busy && groups.length === 0 && <li className="p-3 text-gray-500 text-sm">No groups</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/evolution-client test
pnpm --filter @evo/web typecheck
git add packages/evolution-client "apps/web/src/app/api/workspaces/[slug]/groups" "apps/web/src/app/[workspaceSlug]/groups"
git commit -m "feat(web,evolution-client): groups read-only list + GroupsApi"
```

---

### Task 9: Final review

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm -r test
```

Expected:
- All typecheck PASS
- `@evo/crypto` 0 tests (passWithNoTests)
- `@evo/web` ~20 tests (17 + 3 encrypt)
- `@evo/ai` 4 tests (3 + 1 apiKey override)
- `@evo/evolution-client` 15 tests (13 + integration + groups)
- all 6 e2e specs still passing

- [ ] **Step 2: Plan 6.5 done.**

---

## Plan 6.5 verification checklist

- [ ] Migration `<14-digit>_keys_webhooks/` with 4 new tables + 2 enums.
- [ ] `@evo/crypto` package extracted; encrypt round-trips.
- [ ] `/settings/audit` shows last 200 rows.
- [ ] `/settings/api-keys` creates keys (token shown once), lists, revokes.
- [ ] `/settings/integrations/ai` upserts encrypted Anthropic key per workspace.
- [ ] Ingest automate uses workspace key when present; falls back to env.
- [ ] `/settings/integrations/chatwoot` POSTs to Evolution's chatwoot/set.
- [ ] `/settings/webhooks` creates webhook subscriptions (secret shown once).
- [ ] `/groups` lists WhatsApp groups per instance.

Plan 6.5 done.

**Deferred to Plan 6.6 (the next slice):**
- Worker job that actually POSTs to webhook subscribers when events fire (foundation is here; need to call notifySubscribers from every event source)
- Developer API auth middleware (validate `ek_…` token from Authorization header, look up ApiKey, scope check) — required before the API keys are useful to external integrations
- Typebot / RabbitMQ / SQS / Kafka / Pusher configurators following the Chatwoot pattern
- Real billing integration

Plus the still-pending items:
- Drag-drop visual flow builder (Plan 4 deferral)
- Warmer polish (Plan 5 deferral)
