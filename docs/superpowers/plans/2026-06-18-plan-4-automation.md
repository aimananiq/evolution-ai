# Plan 4 — Automation (chatbot + drip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two automations that respond to and drive WhatsApp conversations: (a) a per-instance chatbot with keyword triggers and an optional Claude AI fallback, fired from the ingest pipeline on inbound messages; (b) drip campaigns that enrol contacts and send a sequence of templates at scheduled intervals via the worker.

**Architecture:** Add `Chatbot`, `KeywordTrigger`, `DripCampaign`, `DripEnrolment` tables. The ingest pipeline (Plan 2) gains an `automate` hook called after a successful inbound message persist — it looks up the instance's chatbot, runs keyword matching, and on no match invokes the Claude SDK with the system prompt + recent message context, then sends the reply through the existing `@evo/send.sendViaInstance` chokepoint (Plan 3). The worker gains a `drip-tick` repeatable that advances `DripEnrolment` rows whose `nextRunAt <= now` and enqueues the next step's send. UI gets a chatbot settings page per instance, drip campaign CRUD with a step editor, and an enrolment trigger that adds a list of contacts to a campaign. Visual flow-builder is deferred to a future plan — keyword + Claude fallback covers the common case for v1.

**Tech Stack:** Inherits Plans 0–3. Adds: `@anthropic-ai/sdk ^0.32.x` for Claude calls (workspace-scoped API key resolution from `process.env.ANTHROPIC_API_KEY` for v1; per-workspace keys in DB are a v2 follow-up).

**Definition of done:**
1. An admin can enable a chatbot per instance with keyword triggers and (optionally) a Claude fallback model + system prompt.
2. An inbound WhatsApp message that matches a keyword auto-replies with the configured response via `sendViaInstance`.
3. An inbound message with NO keyword match invokes Claude with the workspace's recent conversation context (last 6 messages) and sends Claude's reply via `sendViaInstance`.
4. An admin can create a drip campaign of N steps (each step = template + delay) and enrol a contact list.
5. The worker's `drip-tick` runs every minute, picks due enrolments, sends the next step through `sendViaInstance`, advances state, schedules the next.
6. All previous tests pass; new tests added: keyword match logic 4+, drip-engine 4+, chatbot route 2+, drip route 2+.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — section 1 (Automation tables), section 3 (`drip-tick` + `ai-reply` queues), section 4 (chatbot fallback writes through the send chokepoint).

---

## File structure produced by this plan

```
/
├─ packages/
│  ├─ db/prisma/schema.prisma                                       # MODIFIED: + Chatbot, KeywordTrigger, DripCampaign, DripEnrolment
│  ├─ db/prisma/migrations/<ts>_automation/migration.sql            # NEW
│  ├─ db/src/tenant.ts                                              # MODIFIED: + 4 models
│  └─ ai/                                                           # NEW package
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts                                                # claudeReply
│        └─ index.test.ts
├─ apps/
│  ├─ ingest/src/
│  │  ├─ automate.ts                                                # NEW: dispatch keyword + AI on inbound
│  │  ├─ automate.test.ts                                           # NEW
│  │  └─ index.ts                                                   # MODIFIED: call automate() after persist
│  ├─ worker/src/
│  │  ├─ drip-tick.ts                                               # NEW
│  │  ├─ drip-tick.test.ts                                          # NEW (real DB)
│  │  └─ index.ts                                                   # MODIFIED: register drip-tick repeatable
│  └─ web/
│     ├─ package.json                                               # MODIFIED: + @anthropic-ai/sdk
│     ├─ messages/en-GB.json                                        # MODIFIED: chatbot.*, drip.*
│     └─ src/
│        ├─ app/api/workspaces/[slug]/
│        │  ├─ chatbots/route.ts                                    # GET list, POST upsert (one per instance)
│        │  ├─ chatbots/[id]/route.ts                               # GET, PUT, DELETE
│        │  ├─ chatbots/[id]/triggers/route.ts                      # GET, POST
│        │  ├─ chatbots/[id]/triggers/[triggerId]/route.ts          # PUT, DELETE
│        │  ├─ drip-campaigns/route.ts                              # GET list, POST create
│        │  ├─ drip-campaigns/[id]/route.ts                         # GET, PUT, DELETE
│        │  └─ drip-campaigns/[id]/enrol/route.ts                   # POST { contactIds | listId }
│        └─ app/[workspaceSlug]/
│           ├─ automation/page.tsx                                  # hub (links to chatbots + drip)
│           ├─ automation/chatbot/page.tsx                          # list of chatbots per instance
│           ├─ automation/chatbot/[id]/page.tsx                     # editor (server + client form)
│           ├─ automation/chatbot/[id]/editor.tsx                   # client editor
│           ├─ automation/drip/page.tsx                             # list
│           ├─ automation/drip/new/page.tsx                         # create
│           ├─ automation/drip/new/wizard.tsx                       # client
│           └─ automation/drip/[id]/page.tsx                        # detail + enrolments
└─ tests/e2e/automation.spec.ts                                     # NEW: keyword reply + drip dispatch
```

---

### Task 1: Schema — Chatbot, KeywordTrigger, DripCampaign, DripEnrolment

**Files:** modify `packages/db/prisma/schema.prisma`, new migration, modify `packages/db/src/tenant.ts`.

- [ ] **Step 1: Append models to schema.prisma**

After the `BroadcastTarget` model from Plan 3, append:

```prisma
enum ChatbotFallbackProvider {
  none
  claude
  openai
}

enum KeywordMatchType {
  exact
  contains
  startsWith
}

enum DripTriggerType {
  manual
  newContact
}

enum DripEnrolmentStatus {
  active
  completed
  paused
  failed
}

model Chatbot {
  id               String                  @id @default(cuid())
  workspaceId      String
  instanceId       String                  @unique
  enabled          Boolean                 @default(true)
  welcomeMessage   String?
  fallbackProvider ChatbotFallbackProvider @default(none)
  fallbackModel    String?
  systemPrompt     String?
  createdAt        DateTime                @default(now())
  updatedAt        DateTime                @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  triggers  KeywordTrigger[]

  @@index([workspaceId])
}

model KeywordTrigger {
  id        String           @id @default(cuid())
  chatbotId String
  keyword   String
  matchType KeywordMatchType @default(contains)
  response  String
  createdAt DateTime         @default(now())

  chatbot Chatbot @relation(fields: [chatbotId], references: [id], onDelete: Cascade)

  @@index([chatbotId])
}

model DripCampaign {
  id          String           @id @default(cuid())
  workspaceId String
  instanceId  String
  name        String
  triggerType DripTriggerType  @default(manual)
  steps       Json
  active      Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  workspace  Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance   Instance         @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  enrolments DripEnrolment[]

  @@index([workspaceId, active])
}

model DripEnrolment {
  id          String              @id @default(cuid())
  workspaceId String
  campaignId  String
  contactId   String
  currentStep Int                 @default(0)
  status      DripEnrolmentStatus @default(active)
  nextRunAt   DateTime
  startedAt   DateTime            @default(now())
  completedAt DateTime?

  workspace Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  campaign  DripCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  contact   Contact      @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([campaignId, contactId])
  @@index([workspaceId, status, nextRunAt])
}
```

Step structure (`Json` column on DripCampaign):

```json
[
  { "templateId": "tpl-1", "delayMs": 0 },
  { "templateId": "tpl-2", "delayMs": 86400000 },
  { "templateId": "tpl-3", "delayMs": 259200000 }
]
```

(For v1 the only step kind is "send a template". Plan 4.5+ can add conditional / wait-for-reply steps.)

- [ ] **Step 2: Back-relations**

Add to `Workspace`:

```prisma
  chatbots       Chatbot[]
  dripCampaigns  DripCampaign[]
  dripEnrolments DripEnrolment[]
```

Add to `Instance`:

```prisma
  chatbot       Chatbot?
  dripCampaigns DripCampaign[]
```

Add to `Contact`:

```prisma
  dripEnrolments DripEnrolment[]
```

- [ ] **Step 3: Generate migration**

```bash
pnpm --filter @evo/db exec prisma migrate dev --name automation
```

(Or docker-network workaround if host Postgres conflict — same pattern as previous plans.)

- [ ] **Step 4: Extend tenant scope**

In `packages/db/src/tenant.ts`, append 4 entries to `TENANTED_MODELS`:

```typescript
  "Chatbot",
  "KeywordTrigger",
  "DripCampaign",
  "DripEnrolment",
```

(KeywordTrigger doesn't have a `workspaceId` field, but it inherits tenancy via `Chatbot`. Add it anyway for consistency — the tenancy wrapper will skip the injection for KeywordTrigger reads because there's no field; actually we should EXCLUDE it. Re-read the existing wrapper.)

Actually: looking at how `tenant.ts` works, it injects `workspaceId` into the where clause for tenanted models. If KeywordTrigger doesn't have `workspaceId`, the injection breaks queries. So DO NOT add `KeywordTrigger` to TENANTED_MODELS. Tenancy is enforced through the parent Chatbot lookup, same pattern as `ContactLabel` and `ContactListMember`.

Correct entries to add: ONLY:

```typescript
  "Chatbot",
  "DripCampaign",
  "DripEnrolment",
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @evo/db generate
DATABASE_URL="postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public" \
  pnpm --filter @evo/db exec prisma migrate deploy
pnpm --filter @evo/db test
```

Expected: 3/3 tenant tests pass; both DBs have the new tables.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): automation schema (Chatbot, KeywordTrigger, DripCampaign, DripEnrolment)"
```

---

### Task 2: `@evo/ai` package — Claude reply helper (TDD)

**Files:** new `packages/ai/`.

- [ ] **Step 1: package.json**

`packages/ai/package.json`:

```json
{
  "name": "@evo/ai",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

`packages/ai/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Failing test**

`packages/ai/src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMock }; },
}));

import { claudeReply } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("claudeReply", () => {
  it("calls Anthropic with the system prompt + messages and returns the assistant text", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Hi there!" }],
    });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(reply).toBe("Hi there!");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-4-5-20251001",
      system: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    }));
  });

  it("returns empty string if Anthropic returns no text block", async () => {
    createMock.mockResolvedValue({ content: [{ type: "tool_use" }] });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
    });
    expect(reply).toBe("");
  });

  it("throws if ANTHROPIC_API_KEY missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
    })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 3: Implement**

`packages/ai/src/index.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export interface ClaudeReplyInput {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}

export async function claudeReply(input: ClaudeReplyInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: input.model,
    system: input.systemPrompt,
    messages: input.messages,
    max_tokens: input.maxTokens ?? 1024,
  });
  const block = (result.content as any[]).find((b) => b.type === "text");
  return block?.text ?? "";
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm install
pnpm --filter @evo/ai test
pnpm --filter @evo/ai typecheck
git add packages/ai pnpm-lock.yaml
git commit -m "feat(ai): @evo/ai claudeReply helper"
```

Expected: 3/3 passing.

---

### Task 3: Ingest `automate` hook — keyword match + Claude fallback (TDD)

**Files:**
- New: `apps/ingest/src/automate.ts`
- Test: `apps/ingest/src/automate.test.ts`
- Modify: `apps/ingest/src/index.ts` (call automate after persist)
- Modify: `apps/ingest/package.json` (add `@evo/ai`, `@evo/send` deps)

- [ ] **Step 1: package.json**

In `apps/ingest/package.json` dependencies, add:

```json
    "@evo/ai": "workspace:*",
    "@evo/send": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 2: Failing test**

`apps/ingest/src/automate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
}));

vi.mock("@evo/ai", () => ({
  claudeReply: vi.fn(),
}));

const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { claudeReply } = await import("@evo/ai");
const { automate } = await import("./automate");

const mockedSend = vi.mocked(sendViaInstance);
const mockedAi = vi.mocked(claudeReply);

let workspaceId: string;
let instanceId: string;
let conversationId: string;
let chatbotId: string;

async function reset() {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.keywordTrigger.deleteMany();
  await prisma.chatbot.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const conv = await prisma.conversation.create({
    data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123", contactName: "A" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
  conversationId = conv.id;
});

describe("automate", () => {
  it("does nothing when no chatbot configured for the instance", async () => {
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedAi).not.toHaveBeenCalled();
  });

  it("sends keyword response when an exact keyword matches", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    chatbotId = cb.id;
    await prisma.keywordTrigger.create({
      data: { chatbotId, keyword: "hello", matchType: "exact", response: "Hi back!" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hello" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hi back!", to: "60123" }));
    expect(mockedAi).not.toHaveBeenCalled();
  });

  it("matches 'contains' keyword case-insensitively", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "Price", matchType: "contains", response: "RM10" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "what is the price?" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "RM10" }));
  });

  it("falls back to Claude when no keyword matches and provider=claude", async () => {
    const cb = await prisma.chatbot.create({
      data: {
        workspaceId, instanceId, enabled: true,
        fallbackProvider: "claude", fallbackModel: "claude-haiku-4-5-20251001",
        systemPrompt: "Be brief.",
      },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "stock", matchType: "contains", response: "in stock" },
    });
    mockedAi.mockResolvedValue("Hello human.");
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedAi).toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hello human." }));
  });

  it("does NOT call AI when fallbackProvider=none and no keyword matches", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "stock", matchType: "contains", response: "in stock" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedAi).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("does nothing when chatbot.enabled = false", async () => {
    await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: false, fallbackProvider: "claude", fallbackModel: "claude-haiku-4-5-20251001" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedAi).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implement `apps/ingest/src/automate.ts`**

```typescript
import { sendViaInstance } from "@evo/send";
import { claudeReply } from "@evo/ai";

const RECENT_LIMIT = 6;

export interface AutomateInput {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  inboundText: string;
}

export async function automate(input: AutomateInput): Promise<void> {
  const { prisma } = await import("@evo/db");
  const chatbot = await prisma.chatbot.findUnique({
    where: { instanceId: input.instanceId },
    include: { triggers: true },
  });
  if (!chatbot || !chatbot.enabled) return;

  const text = input.inboundText.trim();
  const matched = chatbot.triggers.find((t) => keywordMatches(text, t.keyword, t.matchType));
  if (matched) {
    await sendViaInstance(input.instanceId, {
      type: "text",
      to: input.contactPhone,
      text: matched.response,
      userId: null,
    });
    return;
  }

  if (chatbot.fallbackProvider !== "claude" || !chatbot.fallbackModel) return;

  const recent = await prisma.message.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { sentAt: "desc" },
    take: RECENT_LIMIT,
  });
  const context = recent.reverse().map((m) => ({
    role: m.direction === "inbound" ? "user" as const : "assistant" as const,
    content: m.body ?? "",
  }));

  let reply: string;
  try {
    reply = await claudeReply({
      model: chatbot.fallbackModel,
      systemPrompt: chatbot.systemPrompt ?? "You are a helpful customer service assistant.",
      messages: context.length ? context : [{ role: "user", content: text }],
    });
  } catch {
    return;
  }
  if (!reply) return;

  await sendViaInstance(input.instanceId, {
    type: "text",
    to: input.contactPhone,
    text: reply,
    userId: null,
  });
}

function keywordMatches(text: string, keyword: string, matchType: string): boolean {
  const t = text.toLowerCase();
  const k = keyword.toLowerCase();
  if (matchType === "exact") return t === k;
  if (matchType === "startsWith") return t.startsWith(k);
  return t.includes(k);
}
```

- [ ] **Step 4: Run + commit (skip wiring into index.ts — Step 5)**

```bash
pnpm --filter @evo/ingest test
```

Expected: 19 passing (13 from Plan 2 + 6 new automate tests). Run against real test DB.

- [ ] **Step 5: Modify `apps/ingest/src/index.ts`** to call automate after persist

Locate the block that calls `persistEvent` + `publishEvent`. After publishEvent (still inside the same `if (event) { ... }` block), add a fire-and-forget automate call for inbound messages:

```typescript
        if (event.kind === "message" && event.direction === "inbound" && persisted.conversation && persisted.message) {
          automate({
            workspaceId: workspaceId!,
            instanceId: instanceId!,
            conversationId: persisted.conversation.id,
            contactPhone: event.contactPhone,
            inboundText: event.body ?? "",
          }).catch((err) => log.error({ err: String(err) }, "automate failed"));
        }
```

Add the import at the top:

```typescript
import { automate } from "./automate.js";
```

- [ ] **Step 6: typecheck + commit**

```bash
pnpm --filter @evo/ingest typecheck
git add apps/ingest pnpm-lock.yaml
git commit -m "feat(ingest): automate hook with keyword match + Claude fallback"
```

---

### Task 4: Chatbot API — chatbot CRUD + triggers CRUD

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/chatbots/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/triggers/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/triggers/[triggerId]/route.ts`

- [ ] **Step 1: chatbots/route.ts** (GET + POST upsert)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const upsertSchema = z.object({
  instanceId: z.string(),
  enabled: z.boolean(),
  welcomeMessage: z.string().max(2000).optional().nullable(),
  fallbackProvider: z.enum(["none", "claude", "openai"]),
  fallbackModel: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(4000).optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbots = await db.chatbot.findMany({
      include: { instance: { select: { label: true } }, triggers: true },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ chatbots });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.upsert({
      where: { instanceId: parsed.data.instanceId },
      create: parsed.data as any,
      update: {
        enabled: parsed.data.enabled,
        welcomeMessage: parsed.data.welcomeMessage,
        fallbackProvider: parsed.data.fallbackProvider,
        fallbackModel: parsed.data.fallbackModel,
        systemPrompt: parsed.data.systemPrompt,
      },
    });
    return NextResponse.json({ chatbot });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: chatbots/[id]/route.ts** (GET, PUT, DELETE)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().max(2000).optional().nullable(),
  fallbackProvider: z.enum(["none", "claude", "openai"]).optional(),
  fallbackModel: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(4000).optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({
      where: { id },
      include: { triggers: { orderBy: { createdAt: "asc" } } },
    });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    return NextResponse.json({ chatbot });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.chatbot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Chatbot not found");
    const chatbot = await db.chatbot.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ chatbot });
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
    const existing = await db.chatbot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Chatbot not found");
    await db.chatbot.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: triggers/route.ts** (GET, POST)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  keyword: z.string().min(1).max(80),
  matchType: z.enum(["exact", "contains", "startsWith"]).default("contains"),
  response: z.string().min(1).max(4000),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const triggers = await prisma.keywordTrigger.findMany({
      where: { chatbotId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ triggers });
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
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const trigger = await prisma.keywordTrigger.create({
      data: { chatbotId: id, keyword: parsed.data.keyword, matchType: parsed.data.matchType, response: parsed.data.response },
    });
    return NextResponse.json({ trigger }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: triggers/[triggerId]/route.ts** (PUT, DELETE)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  keyword: z.string().min(1).max(80).optional(),
  matchType: z.enum(["exact", "contains", "startsWith"]).optional(),
  response: z.string().min(1).max(4000).optional(),
});

async function ensureOwnership(workspaceId: string, chatbotId: string, triggerId: string) {
  const db = tenantClient(workspaceId);
  const chatbot = await db.chatbot.findUnique({ where: { id: chatbotId } });
  if (!chatbot) throw new NotFoundError("Chatbot not found");
  const trigger = await prisma.keywordTrigger.findUnique({ where: { id: triggerId } });
  if (!trigger || trigger.chatbotId !== chatbotId) throw new NotFoundError("Trigger not found");
  return trigger;
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string; triggerId: string }> }) {
  const { slug, id, triggerId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    await ensureOwnership(workspace.id, id, triggerId);
    const trigger = await prisma.keywordTrigger.update({ where: { id: triggerId }, data: parsed.data });
    return NextResponse.json({ trigger });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string; triggerId: string }> }) {
  const { slug, id, triggerId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    await ensureOwnership(workspace.id, id, triggerId);
    await prisma.keywordTrigger.delete({ where: { id: triggerId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/chatbots"
git commit -m "feat(web): chatbot + keyword trigger CRUD API"
```

---

### Task 5: Drip campaigns API

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/drip-campaigns/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/drip-campaigns/[id]/route.ts`
- New: `apps/web/src/app/api/workspaces/[slug]/drip-campaigns/[id]/enrol/route.ts`

- [ ] **Step 1: drip-campaigns/route.ts** (GET + POST)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const stepSchema = z.object({
  templateId: z.string(),
  delayMs: z.number().int().min(0).max(60 * 24 * 60 * 60 * 1000),
});

const schema = z.object({
  name: z.string().min(1).max(120),
  instanceId: z.string(),
  triggerType: z.enum(["manual", "newContact"]).default("manual"),
  steps: z.array(stepSchema).min(1).max(50),
  active: z.boolean().optional().default(true),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const campaigns = await db.dripCampaign.findMany({
      include: { _count: { select: { enrolments: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ campaigns });
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
    const campaign = await db.dripCampaign.create({
      data: {
        instanceId: parsed.data.instanceId,
        name: parsed.data.name,
        triggerType: parsed.data.triggerType,
        steps: parsed.data.steps as any,
        active: parsed.data.active,
      } as any,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: drip-campaigns/[id]/route.ts** (GET, PUT, DELETE)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const stepSchema = z.object({
  templateId: z.string(),
  delayMs: z.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  steps: z.array(stepSchema).min(1).max(50).optional(),
  active: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const campaign = await db.dripCampaign.findUnique({
      where: { id },
      include: {
        _count: { select: { enrolments: true } },
        instance: { select: { label: true } },
      },
    });
    if (!campaign) throw new NotFoundError("Campaign not found");
    return NextResponse.json({ campaign });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.dripCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Campaign not found");
    const campaign = await db.dripCampaign.update({
      where: { id },
      data: { ...parsed.data, steps: parsed.data.steps as any },
    });
    return NextResponse.json({ campaign });
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
    const existing = await db.dripCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Campaign not found");
    await db.dripCampaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: enrol/route.ts** (POST)

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  contactIds: z.array(z.string()).optional(),
  listId: z.string().optional(),
}).refine((d) => (d.contactIds && d.contactIds.length) || d.listId, { message: "either contactIds or listId required" });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const campaign = await db.dripCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundError("Campaign not found");

    let contactIds = parsed.data.contactIds ?? [];
    if (parsed.data.listId) {
      const members = await db.contactListMember.findMany({
        where: { listId: parsed.data.listId },
        select: { contactId: true },
      } as any);
      contactIds = members.map((m: any) => m.contactId);
    }
    if (!contactIds.length) {
      return NextResponse.json({ error: "NO_CONTACTS" }, { status: 400 });
    }

    const steps = campaign.steps as Array<{ templateId: string; delayMs: number }>;
    const firstDelay = steps[0]?.delayMs ?? 0;
    const nextRunAt = new Date(Date.now() + firstDelay);

    await db.dripEnrolment.createMany({
      data: contactIds.map((contactId) => ({
        campaignId: id,
        contactId,
        currentStep: 0,
        nextRunAt,
      })),
      skipDuplicates: true,
    } as any);

    return NextResponse.json({ ok: true, enrolled: contactIds.length });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/drip-campaigns"
git commit -m "feat(web): drip campaigns CRUD + enrol API"
```

---

### Task 6: Worker — drip-tick

**Files:**
- New: `apps/worker/src/drip-tick.ts`
- Test: `apps/worker/src/drip-tick.test.ts`
- Modify: `apps/worker/src/index.ts` (register repeatable + worker)

- [ ] **Step 1: drip-tick.ts**

```typescript
import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const BATCH_SIZE = 200;

export async function runDripTick(opts?: { now?: Date }): Promise<{ advanced: number }> {
  const now = opts?.now ?? new Date();
  const due = await prisma.dripEnrolment.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    include: {
      campaign: { include: { instance: true } },
      contact: true,
    },
    take: BATCH_SIZE,
  });
  let advanced = 0;
  for (const e of due) {
    const steps = e.campaign.steps as Array<{ templateId: string; delayMs: number }>;
    if (e.currentStep >= steps.length) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "completed", completedAt: now },
      });
      continue;
    }
    const step = steps[e.currentStep]!;
    const template = await prisma.messageTemplate.findUnique({ where: { id: step.templateId } });
    if (!template) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "failed" },
      });
      continue;
    }
    try {
      await sendViaInstance(e.campaign.instanceId, {
        type: "text",
        to: e.contact.phoneE164,
        text: template.body,
        userId: null,
      });
    } catch {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "failed" },
      });
      continue;
    }

    const nextIndex = e.currentStep + 1;
    if (nextIndex >= steps.length) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, status: "completed", completedAt: now },
      });
    } else {
      const nextDelay = steps[nextIndex]?.delayMs ?? 0;
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + nextDelay) },
      });
    }
    advanced += 1;
  }
  return { advanced };
}
```

- [ ] **Step 2: TDD — drip-tick.test.ts**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
}));

const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { runDripTick } = await import("./drip-tick");

const mockedSend = vi.mocked(sendViaInstance);

let workspaceId: string;
let instanceId: string;
let contactId: string;
let templateAId: string;
let templateBId: string;
let campaignId: string;

async function reset() {
  await prisma.dripEnrolment.deleteMany();
  await prisma.dripCampaign.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "D", slug: "d-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60111" } });
  const tA = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "A", body: "first" } });
  const tB = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "B", body: "second" } });
  const camp = await prisma.dripCampaign.create({
    data: {
      workspaceId: ws.id, instanceId: inst.id, name: "C1", triggerType: "manual",
      steps: [{ templateId: tA.id, delayMs: 0 }, { templateId: tB.id, delayMs: 1000 }] as any,
    },
  });
  workspaceId = ws.id; instanceId = inst.id; contactId = contact.id;
  templateAId = tA.id; templateBId = tB.id; campaignId = camp.id;
});

describe("runDripTick", () => {
  it("advances a due enrolment from step 0 to step 1, sending the first template", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() - 1000) },
    });
    const { advanced } = await runDripTick();
    expect(advanced).toBe(1);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "first" }));
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.currentStep).toBe(1);
    expect(enr?.status).toBe("active");
  });

  it("marks completed when the last step finishes", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 1, nextRunAt: new Date(Date.now() - 1000) },
    });
    await runDripTick();
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.status).toBe("completed");
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "second" }));
  });

  it("does not advance enrolments that are not yet due", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() + 60000) },
    });
    const { advanced } = await runDripTick();
    expect(advanced).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("marks failed when sendViaInstance throws", async () => {
    mockedSend.mockRejectedValue(new Error("evo down"));
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() - 1000) },
    });
    await runDripTick();
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.status).toBe("failed");
  });
});
```

- [ ] **Step 3: Modify `apps/worker/src/index.ts`** to register `drip-tick`

Read the current index.ts. Inside the existing setup (after the broadcast queues block), add:

```typescript
import { runDripTick } from "./drip-tick.js";

const DRIP_TICK_QUEUE = "drip-tick";
const dripTickQueue = new Queue(DRIP_TICK_QUEUE, { connection });
await dripTickQueue.add("tick", {}, { repeat: { every: 60000 }, jobId: "drip-tick:repeat" });
new Worker(DRIP_TICK_QUEUE, async () => {
  const { advanced } = await runDripTick();
  if (advanced > 0) log.info({ advanced }, "drip tick advanced");
}, { connection });
```

(Place after the existing `new Worker(BROADCAST_TICK_QUEUE, ...)` line.)

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @evo/worker typecheck
pnpm --filter @evo/worker test
git add apps/worker
git commit -m "feat(worker): drip-tick repeatable + DripEnrolment engine"
```

Expected: worker tests = 4 (broadcast-send) + 4 (drip-tick) = 8 passing.

---

### Task 7: Automation hub + chatbot UI

**Files:**
- New: `apps/web/src/app/[workspaceSlug]/automation/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/chatbot/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/editor.tsx`
- Modify: `apps/web/messages/en-GB.json`
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx` (Automation nav link)

- [ ] **Step 1: i18n keys**

Add to `apps/web/messages/en-GB.json`:

In the existing `nav` namespace add: `"automation": "Automation"` (alphabetised).

Add a new top-level `automation` namespace:

```json
  "automation": {
    "title": "Automation",
    "chatbots": "Chatbots",
    "drip": "Drip campaigns",
    "chatbot": {
      "title": "Chatbot",
      "enabled": "Enabled",
      "fallbackProvider": "AI fallback provider",
      "providerNone": "No AI fallback",
      "providerClaude": "Claude (Anthropic)",
      "providerOpenai": "OpenAI",
      "fallbackModel": "Model",
      "systemPrompt": "System prompt",
      "welcomeMessage": "Welcome message (optional)",
      "save": "Save chatbot",
      "addTrigger": "Add keyword trigger",
      "keyword": "Keyword",
      "matchType": "Match type",
      "matchExact": "Exact",
      "matchContains": "Contains",
      "matchStartsWith": "Starts with",
      "response": "Reply"
    },
    "drip": {
      "newCampaign": "New campaign",
      "name": "Name",
      "instance": "Send from",
      "trigger": "Trigger",
      "triggerManual": "Manual enrolment",
      "triggerNewContact": "New contact",
      "addStep": "Add step",
      "template": "Template",
      "delay": "Delay (ms)",
      "create": "Create campaign",
      "active": "Active",
      "enrol": "Enrol contacts from list",
      "enrolledCount": "enrolled"
    }
  },
```

Verify JSON.

- [ ] **Step 2: Nav link**

In `apps/web/src/app/[workspaceSlug]/layout.tsx`, add an Automation link after Broadcasts:

```tsx
        <Link href={`/${workspaceSlug}/automation`} className="block">{t("nav.automation")}</Link>
```

- [ ] **Step 3: Automation hub**

`apps/web/src/app/[workspaceSlug]/automation/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";

export default async function AutomationHub({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("automation.title")}</h1>
      <ul className="space-y-2">
        <li>
          <Link href={`/${workspaceSlug}/automation/chatbot`} className="block border rounded p-4 hover:bg-gray-50">
            <strong>{t("automation.chatbots")}</strong>
            <p className="text-sm text-gray-600">Keyword triggers + AI fallback per WhatsApp instance.</p>
          </Link>
        </li>
        <li>
          <Link href={`/${workspaceSlug}/automation/drip`} className="block border rounded p-4 hover:bg-gray-50">
            <strong>{t("automation.drip")}</strong>
            <p className="text-sm text-gray-600">Sequence of templates sent to enrolled contacts.</p>
          </Link>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Chatbot list page**

`apps/web/src/app/[workspaceSlug]/automation/chatbot/page.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";

export default async function ChatbotsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({
    include: { chatbot: { include: { _count: { select: { triggers: true } } } } },
  });

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("automation.chatbots")}</h1>
      <ul className="border rounded divide-y">
        {instances.map((inst) => (
          <li key={inst.id} className="p-3 flex justify-between">
            <span>
              <strong>{inst.label}</strong>
              {inst.chatbot
                ? <span className="text-sm text-gray-500"> · {inst.chatbot.enabled ? "enabled" : "disabled"} · {inst.chatbot._count.triggers} triggers</span>
                : <span className="text-sm text-gray-500"> · not configured</span>}
            </span>
            <Link href={`/${workspaceSlug}/automation/chatbot/${inst.id}`} className="text-sm underline">{t("instances.openDetail")}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Chatbot editor page (server shell)**

`apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/page.tsx`:

The `[id]` here is the **instance id** for v1 simplicity (one chatbot per instance). Server fetches the chatbot (may be null), passes to editor.

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import Editor from "./editor";

export default async function ChatbotEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instance = await db.instance.findUnique({ where: { id } });
  if (!instance) notFound();
  const chatbot = await db.chatbot.findUnique({ where: { instanceId: id }, include: { triggers: { orderBy: { createdAt: "asc" } } } });

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("automation.chatbot.title")} · {instance.label}</h1>
      <Editor
        workspaceSlug={workspaceSlug}
        instanceId={id}
        initial={chatbot ? {
          id: chatbot.id,
          enabled: chatbot.enabled,
          welcomeMessage: chatbot.welcomeMessage,
          fallbackProvider: chatbot.fallbackProvider,
          fallbackModel: chatbot.fallbackModel,
          systemPrompt: chatbot.systemPrompt,
          triggers: chatbot.triggers.map((tr) => ({ id: tr.id, keyword: tr.keyword, matchType: tr.matchType, response: tr.response })),
        } : null}
      />
    </div>
  );
}
```

- [ ] **Step 6: Chatbot editor (client)**

`apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/editor.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Trigger = { id?: string; keyword: string; matchType: "exact" | "contains" | "startsWith"; response: string };
type Initial = {
  id: string;
  enabled: boolean;
  welcomeMessage: string | null;
  fallbackProvider: "none" | "claude" | "openai";
  fallbackModel: string | null;
  systemPrompt: string | null;
  triggers: Trigger[];
};

export default function Editor({ workspaceSlug, instanceId, initial }: {
  workspaceSlug: string; instanceId: string; initial: Initial | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [welcome, setWelcome] = useState(initial?.welcomeMessage ?? "");
  const [provider, setProvider] = useState<"none" | "claude" | "openai">(initial?.fallbackProvider ?? "none");
  const [model, setModel] = useState(initial?.fallbackModel ?? "claude-haiku-4-5-20251001");
  const [prompt, setPrompt] = useState(initial?.systemPrompt ?? "You are a friendly customer service agent.");
  const [chatbotId, setChatbotId] = useState<string | null>(initial?.id ?? null);
  const [triggers, setTriggers] = useState<Trigger[]>(initial?.triggers ?? []);
  const [newTrigger, setNewTrigger] = useState<Trigger>({ keyword: "", matchType: "contains", response: "" });
  const [busy, setBusy] = useState(false);

  async function saveChatbot() {
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId, enabled,
        welcomeMessage: welcome || null,
        fallbackProvider: provider,
        fallbackModel: provider === "none" ? null : model,
        systemPrompt: provider === "none" ? null : prompt,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const { chatbot } = await res.json();
      setChatbotId(chatbot.id);
      router.refresh();
    }
  }

  async function addTrigger() {
    if (!chatbotId) {
      await saveChatbot();
      if (!chatbotId) return;
    }
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(newTrigger),
    });
    if (res.ok) {
      const { trigger } = await res.json();
      setTriggers((arr) => [...arr, trigger]);
      setNewTrigger({ keyword: "", matchType: "contains", response: "" });
    }
  }

  async function removeTrigger(id: string | undefined) {
    if (!id || !chatbotId) return;
    await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers/${id}`, { method: "DELETE" });
    setTriggers((arr) => arr.filter((tr) => tr.id !== id));
  }

  return (
    <div className="space-y-6">
      <section className="border rounded p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("automation.chatbot.enabled")}
        </label>
        <label className="block">
          <span className="text-sm">{t("automation.chatbot.welcomeMessage")}</span>
          <textarea className="w-full border rounded p-2 mt-1" rows={2} value={welcome} onChange={(e) => setWelcome(e.target.value)} maxLength={2000} />
        </label>
        <label className="block">
          <span className="text-sm">{t("automation.chatbot.fallbackProvider")}</span>
          <select className="w-full border rounded p-2 mt-1" value={provider} onChange={(e) => setProvider(e.target.value as any)}>
            <option value="none">{t("automation.chatbot.providerNone")}</option>
            <option value="claude">{t("automation.chatbot.providerClaude")}</option>
            <option value="openai">{t("automation.chatbot.providerOpenai")}</option>
          </select>
        </label>
        {provider !== "none" && (
          <>
            <label className="block">
              <span className="text-sm">{t("automation.chatbot.fallbackModel")}</span>
              <input className="w-full border rounded p-2 mt-1" value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} />
            </label>
            <label className="block">
              <span className="text-sm">{t("automation.chatbot.systemPrompt")}</span>
              <textarea className="w-full border rounded p-2 mt-1" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} />
            </label>
          </>
        )}
        <button disabled={busy} onClick={saveChatbot} className="bg-black text-white rounded p-2 px-4">{t("automation.chatbot.save")}</button>
      </section>

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.chatbot.addTrigger")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className="border rounded p-2" placeholder={t("automation.chatbot.keyword")} value={newTrigger.keyword} onChange={(e) => setNewTrigger({ ...newTrigger, keyword: e.target.value })} maxLength={80} />
          <select className="border rounded p-2" value={newTrigger.matchType} onChange={(e) => setNewTrigger({ ...newTrigger, matchType: e.target.value as any })}>
            <option value="exact">{t("automation.chatbot.matchExact")}</option>
            <option value="contains">{t("automation.chatbot.matchContains")}</option>
            <option value="startsWith">{t("automation.chatbot.matchStartsWith")}</option>
          </select>
          <input className="border rounded p-2" placeholder={t("automation.chatbot.response")} value={newTrigger.response} onChange={(e) => setNewTrigger({ ...newTrigger, response: e.target.value })} maxLength={4000} />
        </div>
        <button onClick={addTrigger} disabled={!newTrigger.keyword || !newTrigger.response} className="bg-black text-white rounded p-2 px-4 disabled:opacity-50">{t("automation.chatbot.addTrigger")}</button>
        <ul className="border rounded divide-y">
          {triggers.map((tr) => (
            <li key={tr.id} className="p-3 flex justify-between">
              <span><strong>{tr.keyword}</strong> ({tr.matchType}) → <em>{tr.response}</em></span>
              <button onClick={() => removeTrigger(tr.id)} className="text-red-600 text-sm underline">Delete</button>
            </li>
          ))}
          {triggers.length === 0 && <li className="p-3 text-gray-500 text-sm">—</li>}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 7: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/automation" "apps/web/src/app/[workspaceSlug]/layout.tsx" apps/web/messages/en-GB.json
git commit -m "feat(web): automation hub + chatbot editor UI"
```

---

### Task 8: Drip campaign UI (list, new, detail)

**Files:**
- New: `apps/web/src/app/[workspaceSlug]/automation/drip/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/drip/new/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/drip/new/wizard.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/drip/[id]/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/automation/drip/[id]/enrol-form.tsx`

- [ ] **Step 1: Drip list page**

```tsx
// apps/web/src/app/[workspaceSlug]/automation/drip/page.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";

export default async function DripListPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const campaigns = await db.dripCampaign.findMany({
    include: { _count: { select: { enrolments: true } }, instance: { select: { label: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">{t("automation.drip")}</h1>
        <Link href={`/${workspaceSlug}/automation/drip/new`} className="bg-black text-white rounded p-2 px-4">{t("automation.drip.newCampaign")}</Link>
      </div>
      <ul className="border rounded divide-y">
        {campaigns.map((c) => (
          <li key={c.id} className="p-3 flex justify-between">
            <Link href={`/${workspaceSlug}/automation/drip/${c.id}`} className="block flex-1">
              <strong>{c.name}</strong> <span className="text-sm text-gray-500">· {c.instance?.label} · {c._count.enrolments} {t("automation.drip.enrolledCount")}</span>
            </Link>
          </li>
        ))}
        {campaigns.length === 0 && <li className="p-4 text-gray-400 text-sm">—</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Drip new wizard**

```tsx
// apps/web/src/app/[workspaceSlug]/automation/drip/new/page.tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import Wizard from "./wizard";

export default async function NewDripPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const [instances, templates] = await Promise.all([
    db.instance.findMany({ select: { id: true, label: true } }),
    db.messageTemplate.findMany({ select: { id: true, name: true } }),
  ]);
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("automation.drip.newCampaign")}</h1>
      <Wizard workspaceSlug={workspaceSlug} instances={instances} templates={templates} />
    </div>
  );
}
```

```tsx
// apps/web/src/app/[workspaceSlug]/automation/drip/new/wizard.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Step = { templateId: string; delayMs: number };

export default function Wizard({ workspaceSlug, instances, templates }: {
  workspaceSlug: string;
  instances: { id: string; label: string }[];
  templates: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [steps, setSteps] = useState<Step[]>([{ templateId: templates[0]?.id ?? "", delayMs: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStep() {
    setSteps((s) => [...s, { templateId: templates[0]?.id ?? "", delayMs: 86400000 }]);
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((s) => s.map((st, idx) => idx === i ? { ...st, ...patch } : st));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/drip-campaigns`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, instanceId, steps }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      return;
    }
    const { campaign } = await res.json();
    router.push(`/${workspaceSlug}/automation/drip/${campaign.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className="w-full border rounded p-2" placeholder={t("automation.drip.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <label className="block">
        <span className="text-sm">{t("automation.drip.instance")}</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Steps</h3>
        {steps.map((st, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-6">
              <span className="text-xs">{t("automation.drip.template")}</span>
              <select className="w-full border rounded p-2" value={st.templateId} onChange={(e) => updateStep(i, { templateId: e.target.value })} required>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="col-span-4">
              <span className="text-xs">{t("automation.drip.delay")}</span>
              <input type="number" className="w-full border rounded p-2" value={st.delayMs} onChange={(e) => updateStep(i, { delayMs: Number(e.target.value) })} min={0} />
            </div>
            <button type="button" onClick={() => removeStep(i)} disabled={steps.length === 1} className="col-span-2 text-red-600 text-sm underline disabled:opacity-50">×</button>
          </div>
        ))}
        <button type="button" onClick={addStep} className="text-sm underline">{t("automation.drip.addStep")}</button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("automation.drip.create")}</button>
    </form>
  );
}
```

- [ ] **Step 3: Drip detail page**

```tsx
// apps/web/src/app/[workspaceSlug]/automation/drip/[id]/page.tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import EnrolForm from "./enrol-form";

export default async function DripDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const campaign = await db.dripCampaign.findUnique({
    where: { id },
    include: { _count: { select: { enrolments: true } }, instance: { select: { label: true } } },
  });
  if (!campaign) notFound();
  const lists = await db.contactList.findMany({ select: { id: true, name: true, _count: { select: { members: true } } } });
  const steps = campaign.steps as Array<{ templateId: string; delayMs: number }>;
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{campaign.name}</h1>
      <dl className="grid grid-cols-2 text-sm gap-y-1">
        <dt className="text-gray-500">{t("automation.drip.instance")}</dt><dd>{campaign.instance?.label ?? "?"}</dd>
        <dt className="text-gray-500">Steps</dt><dd>{steps.length}</dd>
        <dt className="text-gray-500">{t("automation.drip.enrolledCount")}</dt><dd>{campaign._count.enrolments}</dd>
        <dt className="text-gray-500">{t("automation.drip.active")}</dt><dd>{campaign.active ? "Yes" : "No"}</dd>
      </dl>
      <EnrolForm workspaceSlug={workspaceSlug} campaignId={id} lists={lists.map((l) => ({ id: l.id, name: l.name, members: l._count.members }))} />
    </div>
  );
}
```

```tsx
// apps/web/src/app/[workspaceSlug]/automation/drip/[id]/enrol-form.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function EnrolForm({ workspaceSlug, campaignId, lists }: {
  workspaceSlug: string; campaignId: string; lists: { id: string; name: string; members: number }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function enrol(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/drip-campaigns/${campaignId}/enrol`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ listId }),
    });
    setBusy(false);
    if (res.ok) {
      const { enrolled } = await res.json();
      setFeedback(`${enrolled} ${t("automation.drip.enrolledCount")}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={enrol} className="border rounded p-3 space-y-2">
      <h2 className="font-semibold">{t("automation.drip.enrol")}</h2>
      <select className="w-full border rounded p-2" value={listId} onChange={(e) => setListId(e.target.value)} required>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.members})</option>)}
      </select>
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("automation.drip.enrol")}</button>
      {feedback && <p className="text-sm">{feedback}</p>}
    </form>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/automation/drip"
git commit -m "feat(web): drip campaign UI (list, wizard, detail + enrol)"
```

---

### Task 9: E2E automation + final review

**File:** `tests/e2e/automation.spec.ts`

The test:
1. Sign up, create workspace, create instance.
2. Configure chatbot with a single keyword trigger.
3. POST a synthetic inbound message to ingest that matches the keyword.
4. Assert the stub Evolution received a sendText call with the matching reply.

For the stub to record sends, use the stub server pattern from previous plans and inspect the call log.

- [ ] **Step 1: Spec**

```typescript
import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18083;
const sentMessages: string[] = [];

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub" }, hash: "stub-key" })); return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub", state: "open" } })); return;
    }
    if (req.url?.startsWith("/webhook/set/")) {
      res.writeHead(200); res.end(JSON.stringify({ webhook: { enabled: true } })); return;
    }
    if (req.url?.startsWith("/message/sendText/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      sentMessages.push(body.text ?? "");
      res.writeHead(200); res.end(JSON.stringify({ key: { id: `EVO-${sentMessages.length}` }, status: "PENDING" }));
      return;
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

test("admin configures chatbot keyword trigger; inbound webhook fires auto-reply", async ({ browser, request }) => {
  sentMessages.length = 0;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("auto");

  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Auto Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Auto WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);

  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const insts = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances`, { headers: { cookie: cookieHeader } });
  const { instances } = await insts.json();
  const instance = instances[0];

  // Create chatbot via API
  const cbRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/chatbots`, {
    headers: { cookie: cookieHeader },
    data: { instanceId: instance.id, enabled: true, fallbackProvider: "none" },
  });
  expect(cbRes.ok()).toBe(true);
  const { chatbot } = await cbRes.json();

  await request.post(`http://localhost:3000/api/workspaces/${slug}/chatbots/${chatbot.id}/triggers`, {
    headers: { cookie: cookieHeader },
    data: { keyword: "menu", matchType: "exact", response: "Here is our menu: 1) coffee 2) tea" },
  });

  // POST inbound webhook
  await request.post(`http://localhost:4000/whatsapp/webhook/${instance.workspaceId}/${instance.id}`, {
    data: {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-INBOUND-AUTO", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "menu" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });

  // Wait up to 5s for the automate call to round-trip
  for (let i = 0; i < 20; i++) {
    if (sentMessages.length > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(sentMessages.find((m) => m.includes("menu"))).toBeTruthy();
});
```

- [ ] **Step 2: Run**

Prerequisites (same as Plan 3 e2e):

```bash
docker compose up -d postgres-manager redis-manager
pnpm --filter @evo/db exec prisma migrate deploy
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :4000 | xargs kill -9 2>/dev/null || true

# Update apps/web/.env.local: EVOLUTION_BASE_URL=http://localhost:18083, EVOLUTION_GLOBAL_API_KEY=stub-key, WEBHOOK_INBOUND_ALLOW_UNSAFE=true

EVOLUTION_BASE_URL=http://localhost:18083 EVOLUTION_GLOBAL_API_KEY=stub-key REDIS_URL=redis://localhost:6379/0 \
  PORT=4000 pnpm --filter @evo/ingest dev > /tmp/ingest.log 2>&1 &
INGEST_PID=$!
sleep 4

pnpm --filter @evo/web test:e2e -- automation.spec.ts

kill $INGEST_PID 2>/dev/null
```

Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/automation.spec.ts
git commit -m "test(e2e): chatbot keyword reply through ingest pipeline"
```

---

### Task 10: Plan 4 final review

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm -r test
```

Expected:
- All packages typecheck PASS
- Total unit tests: ~78 (62 from Plan 3 + 3 ai + 6 automate + 4 drip-tick = 75; minor variance ok)
- 5 e2e specs all passing

- [ ] **Step 2: Plan 4 done. Next: Plan 5 — Warmer port.**

---

## Plan 4 verification checklist

- [ ] Schema migration `<14-digit>_automation/` exists with 4 new tables + 4 new enums.
- [ ] `@evo/ai` package with claudeReply unit-tested (mocked SDK).
- [ ] Ingest `automate.ts` correctly does keyword match → AI fallback → send via @evo/send.
- [ ] Chatbot API CRUD + trigger CRUD.
- [ ] Drip campaign CRUD + enrol API.
- [ ] Worker drip-tick repeatable advances enrolments through templates.
- [ ] Automation hub + chatbot editor + drip wizard + drip detail UI all linked from sidebar.
- [ ] All previous tests still pass; new tests pass.
- [ ] E2E proves a keyword trigger replies via the chokepoint.

When all checked: Plan 4 done. **Next: Plan 5 — Warmer port**, **Plan 6 — Groups + integrations + admin + analytics + plan limits**, and a visual flow-builder if the user requests it after using keyword+AI in production.
