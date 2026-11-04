# Plan 9 — AI Actions (Auto Label, Human Takeover, Auto Follow-Up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer three first-class chatbot automation behaviours — **Auto Label**, **Human Takeover**, **Auto Follow-Up** — onto the existing per-instance `Chatbot`, plus a **Chatbot Settings** surface (General + AI Settings + Advanced) and a per-contact **User Logs** viewer (`BotUserLog`). These mirror Wasapbot's "AI Action Settings", "Chatbot Settings" and "User Logs" pages.

**Architecture:**
- One `AiActionConfig` row per `Chatbot` (1:1), holding three JSON blobs (`autoLabel`, `humanTakeover`, `autoFollowUp`). Validated by nested zod on write; read back into typed UI.
- Inbound automation engines live in `apps/ingest/src/ai-actions.ts` and are invoked from `apps/ingest/src/automate.ts` **before** the existing keyword/Claude reply logic. A new `botPaused` flag on `Conversation` short-circuits bot replies (set by Human Takeover; reused by the inbox's existing `Assignment`/three-pane UI).
- Auto Follow-Up **reuses the existing Drip engine** (`DripCampaign`/`DripEnrolment` + `apps/worker/src/drip-tick.ts` pattern) via a parallel, purpose-built `follow-up-tick.ts` reading `DripEnrolment` rows tagged to a synthetic follow-up campaign. See Task 5 for the justification of reuse-vs-mirror.
- Every action writes a `BotUserLog` row (the User Logs viewer's data source).
- Web layer follows the established route-handler contract: `requireMember(slug, role)` → `tenantClient(workspace.id)` → zod `safeParse` (fail → `400 VALIDATION`) → try/catch → `{ error: e.code }` on `AppError`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Prisma + PostgreSQL, Next.js 15 App Router (server page → `"use client"` child), next-intl (`apps/web/messages/en-GB.json`), BullMQ workers, Vitest, `@evo/send` (`sendViaInstance`), `@evo/ai` (`claudeReply`), `@evo/shared` (`AppError`, `NotFoundError`).

**Depends on:** Plan 7 (MediaPicker — used for optional follow-up media; **not yet built**, so follow-up `mediaAssetId` is schema-optional and the UI degrades to a text-only step with a TODO marker). Reuses Plan 4 drip engine (`DripCampaign`/`DripEnrolment`, `drip-tick.ts`). Reuses Plan 2 inbox `Assignment` + `Conversation` three-pane UI for human takeover.

---

## File Structure

```
packages/db/
  prisma/schema.prisma                      # +AiActionConfig +BotUserLog +enums; extend Chatbot, Conversation
  prisma/migrations/<ts>_ai_actions/        # generated
  src/tenant.ts                             # +AiActionConfig +BotUserLog in TENANTED_MODELS

apps/ingest/src/
  ai-actions.ts                             # applyAutoLabel, detectAndApplyTakeover, enrolFollowUp, writeBotLog
  ai-actions.test.ts                        # unit tests for the three engines
  automate.ts                               # wire: auto-label → botPaused guard → takeover → existing reply
  automate.test.ts                          # extend with botPaused + takeover assertions

apps/worker/src/
  follow-up-tick.ts                         # mirror drip-tick; send due follow-up steps + BotUserLog
  follow-up-tick.test.ts
  index.ts                                  # register follow-up-tick queue

apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/
  ai-actions/route.ts                       # GET/PUT AiActionConfig (Admin)
  route.ts                                  # extend PUT updateSchema with Settings fields

apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/logs/route.ts   # GET BotUserLog (Viewer, filtered)

apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/
  ai-actions/page.tsx + ai-actions-editor.tsx     # Auto Label / Human Takeover / Auto Follow-Up
  settings/page.tsx + settings-editor.tsx         # General + AI Settings + Advanced
  logs/page.tsx + logs-table.tsx                  # User Logs viewer

apps/web/messages/en-GB.json                # +aiActions namespace
```

---

### Task 1: Schema — AiActionConfig, BotUserLog, Conversation.botPaused, Chatbot settings fields

**Files:**
- `packages/db/prisma/schema.prisma`
- `packages/db/src/tenant.ts`

- [ ] Add enums + models to `schema.prisma` after the existing `KeywordTrigger` model. Use exactly these names (referenced verbatim by every later task):

```prisma
enum BotNotifyType {
  whatsapp_number
  whatsapp_group
}

enum FollowUpLastSender {
  chatbot
  customer
}

enum BotUserLogKind {
  trigger_matched
  ai_reply
  auto_label
  human_takeover
  follow_up_sent
  action_run
}

/// 1:1 with Chatbot. The three JSON blobs are validated by zod in the API layer.
model AiActionConfig {
  id            String   @id @default(cuid())
  workspaceId   String
  chatbotId     String   @unique
  autoLabel     Json     @default("{\"enabled\":false,\"rules\":[]}")
  humanTakeover Json     @default("{\"enabled\":false}")
  autoFollowUp  Json     @default("{\"enabled\":false,\"steps\":[]}")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  chatbot   Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}

model BotUserLog {
  id             String         @id @default(cuid())
  workspaceId    String
  conversationId String?
  contactId      String?
  instanceId     String
  kind           BotUserLogKind
  detail         Json?
  createdAt      DateTime       @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([conversationId, createdAt])
  @@index([instanceId, createdAt])
}
```

- [ ] Extend `model Conversation` (add the two fields + keep everything else):

```prisma
  botPaused         Boolean            @default(false)
  botPausedReason   String?
```

- [ ] Extend `model Chatbot` with the Settings-screenshot fields not covered elsewhere, and add the `AiActionConfig` back-relation:

```prisma
  aiTemperature      Float?
  aiContextLength    Int?
  scheduleJson       Json?
  pauseBot           Boolean   @default(false)
  unsubscribeKeyword String?
  limiterJson        Json?
  filterJson         Json?

  aiActionConfig AiActionConfig?
```

- [ ] Add the two new back-relations to `model Workspace`:

```prisma
  aiActionConfigs AiActionConfig[]
  botUserLogs     BotUserLog[]
```

- [ ] Add both new models to `TENANTED_MODELS` in `packages/db/src/tenant.ts` (the `Set` literal):

```ts
  "AiActionConfig",
  "BotUserLog",
```

- [ ] Generate the migration and client:

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && \
  pnpm --filter @evo/db exec prisma migrate dev --name ai_actions && \
  pnpm --filter @evo/db exec prisma generate
```
Expected: `migrations/<ts>_ai_actions/migration.sql` created; `✔ Generated Prisma Client`. The SQL must contain `ALTER TABLE "Conversation" ADD COLUMN "botPaused"` and `CREATE TABLE "AiActionConfig"` + `CREATE TABLE "BotUserLog"`.

- [ ] **Commit:** `git add -A && git commit -m "feat(db): AiActionConfig, BotUserLog, Conversation.botPaused, chatbot settings fields"` (append the required `Co-Authored-By` trailer).

---

### Task 2: Auto Label engine + shared types + writeBotLog

**Files:**
- `apps/ingest/src/ai-actions.ts` (new)
- `apps/ingest/src/ai-actions.test.ts` (new)

Write the test first (TDD).

- [ ] Define the shared config types + `writeBotLog` + `applyAutoLabel` in `apps/ingest/src/ai-actions.ts`:

```ts
import { sendViaInstance } from "@evo/send";

// ---- Config shapes (must match the zod schemas in the API layer) ----
export interface AutoLabelRule {
  /** substring match against the inbound text, case-insensitive; empty = always */
  contains: string;
  labelId: string;
  op: "add" | "remove";
}
export interface AutoLabelConfig { enabled: boolean; rules: AutoLabelRule[] }

export interface HumanTakeoverConfig {
  enabled: boolean;
  triggerKeywords: string[];
  notifyType: "whatsapp_number" | "whatsapp_group";
  notifyTargets: string[];
  agentMessageTemplate: string; // supports {{user_phone}}
  disableBotOnTakeover: boolean;
  userMessage: string;
}

export interface FollowUpStep { text: string; delaySeconds: number; mediaAssetId?: string | null }
export interface AutoFollowUpConfig {
  enabled: boolean;
  lastSenderFilter: "chatbot" | "customer";
  conditions: { scheduleJson?: unknown; contactGroupIds: string[]; labelIds: string[]; extra?: unknown };
  steps: FollowUpStep[];
}

export interface ActionCtx {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  inboundText: string;
}

export type BotLogKind =
  | "trigger_matched" | "ai_reply" | "auto_label"
  | "human_takeover" | "follow_up_sent" | "action_run";

export async function writeBotLog(
  ctx: { workspaceId: string; instanceId: string; conversationId?: string | null; contactId?: string | null },
  kind: BotLogKind,
  detail: Record<string, unknown>,
): Promise<void> {
  const { prisma } = await import("@evo/db");
  await prisma.botUserLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      instanceId: ctx.instanceId,
      conversationId: ctx.conversationId ?? null,
      contactId: ctx.contactId ?? null,
      kind,
      detail,
    },
  });
}

/** Evaluate auto-label rules against the inbound message and upsert ContactLabel. */
export async function applyAutoLabel(ctx: ActionCtx, cfg: AutoLabelConfig): Promise<void> {
  if (!cfg.enabled || cfg.rules.length === 0) return;
  const { prisma } = await import("@evo/db");
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  if (!contact) return;

  const text = ctx.inboundText.toLowerCase();
  const applied: Array<{ labelId: string; op: "add" | "remove" }> = [];
  for (const rule of cfg.rules) {
    const needle = (rule.contains ?? "").toLowerCase();
    if (needle && !text.includes(needle)) continue;
    if (rule.op === "add") {
      await prisma.contactLabel.upsert({
        where: { contactId_labelId: { contactId: contact.id, labelId: rule.labelId } },
        create: { contactId: contact.id, labelId: rule.labelId },
        update: {},
      });
    } else {
      await prisma.contactLabel.deleteMany({ where: { contactId: contact.id, labelId: rule.labelId } });
    }
    applied.push({ labelId: rule.labelId, op: rule.op });
  }
  if (applied.length) {
    await writeBotLog(
      { workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, conversationId: ctx.conversationId, contactId: contact.id },
      "auto_label",
      { applied },
    );
  }
}
```

- [ ] Write `apps/ingest/src/ai-actions.test.ts` (mock `@evo/send`, use the real test DB exactly like `automate.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));

const { prisma } = await import("@evo/db");
const { applyAutoLabel } = await import("./ai-actions");

let workspaceId: string, instanceId: string, conversationId: string, contactId: string, labelId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.botUserLog.deleteMany();
  await prisma.contactLabel.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.label.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e-" + Date.now(), evolutionApiKey: "K" } });
  const conv = await prisma.conversation.create({ data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123" } });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123" } });
  const label = await prisma.label.create({ data: { workspaceId: ws.id, name: "VIP" } });
  workspaceId = ws.id; instanceId = inst.id; conversationId = conv.id; contactId = contact.id; labelId = label.id;
});

describe("applyAutoLabel", () => {
  it("adds a label when the rule matches and logs it", async () => {
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I want a REFUND please" },
      { enabled: true, rules: [{ contains: "refund", labelId, op: "add" }] },
    );
    const links = await prisma.contactLabel.findMany({ where: { contactId } });
    expect(links).toHaveLength(1);
    const log = await prisma.botUserLog.findFirst({ where: { kind: "auto_label" } });
    expect(log).not.toBeNull();
  });

  it("does nothing when disabled", async () => {
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "refund" },
      { enabled: false, rules: [{ contains: "refund", labelId, op: "add" }] },
    );
    expect(await prisma.contactLabel.count()).toBe(0);
  });

  it("removes a label with op=remove", async () => {
    await prisma.contactLabel.create({ data: { contactId, labelId } });
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "thanks resolved" },
      { enabled: true, rules: [{ contains: "resolved", labelId, op: "remove" }] },
    );
    expect(await prisma.contactLabel.count()).toBe(0);
  });
});
```

- [ ] Run: `pnpm --filter @evo/ingest test`. Expected: `applyAutoLabel` describe block — 3 passing.

- [ ] **Commit:** `feat(ingest): auto-label engine + writeBotLog + action types`.

---

### Task 3: Human Takeover engine

**Files:**
- `apps/ingest/src/ai-actions.ts` (extend)
- `apps/ingest/src/ai-actions.test.ts` (extend)

- [ ] Append `detectAndApplyTakeover` to `apps/ingest/src/ai-actions.ts`:

```ts
function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => k.trim() && t.includes(k.toLowerCase().trim()));
}

/** Returns true if a human takeover was triggered (caller must then stop bot replies). */
export async function detectAndApplyTakeover(ctx: ActionCtx, cfg: HumanTakeoverConfig): Promise<boolean> {
  if (!cfg.enabled) return false;
  if (!matchesAnyKeyword(ctx.inboundText, cfg.triggerKeywords ?? [])) return false;

  const { prisma } = await import("@evo/db");

  if (cfg.disableBotOnTakeover) {
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { botPaused: true, botPausedReason: "human_takeover" },
    });
  }

  // Notify agent(s)/group.
  const agentText = (cfg.agentMessageTemplate ?? "").replaceAll("{{user_phone}}", ctx.contactPhone);
  for (const target of cfg.notifyTargets ?? []) {
    try {
      await sendViaInstance(ctx.instanceId, { type: "text", to: target, text: agentText, userId: null });
    } catch { /* notification best-effort */ }
  }

  // Acknowledge the customer.
  if (cfg.userMessage?.trim()) {
    try {
      await sendViaInstance(ctx.instanceId, { type: "text", to: ctx.contactPhone, text: cfg.userMessage, userId: null });
    } catch { /* best-effort */ }
  }

  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  await writeBotLog(
    { workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, conversationId: ctx.conversationId, contactId: contact?.id ?? null },
    "human_takeover",
    { notifyType: cfg.notifyType, notifiedTargets: cfg.notifyTargets, botPaused: cfg.disableBotOnTakeover },
  );
  return true;
}
```

- [ ] Extend `ai-actions.test.ts` with a `detectAndApplyTakeover` describe block:

```ts
const { detectAndApplyTakeover } = await import("./ai-actions");
const { sendViaInstance } = await import("@evo/send");
const mockedSend = vi.mocked(sendViaInstance);

describe("detectAndApplyTakeover", () => {
  const cfg = {
    enabled: true,
    triggerKeywords: ["agent", "human"],
    notifyType: "whatsapp_number" as const,
    notifyTargets: ["60999"],
    agentMessageTemplate: "Takeover for {{user_phone}}",
    disableBotOnTakeover: true,
    userMessage: "Connecting you to a human.",
  };

  it("pauses the conversation, notifies agent, messages user and logs", async () => {
    const fired = await detectAndApplyTakeover(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I need an agent now" },
      cfg,
    );
    expect(fired).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.botPaused).toBe(true);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999", text: "Takeover for 60123" }));
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60123", text: "Connecting you to a human." }));
    expect(await prisma.botUserLog.count({ where: { kind: "human_takeover" } })).toBe(1);
  });

  it("returns false when no keyword matches", async () => {
    const fired = await detectAndApplyTakeover(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "what is the price" },
      cfg,
    );
    expect(fired).toBe(false);
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.botPaused).toBe(false);
  });
});
```

- [ ] Run: `pnpm --filter @evo/ingest test`. Expected: takeover block — 2 passing (5 total in file).

- [ ] **Commit:** `feat(ingest): human-takeover engine (pause + notify + ack)`.

---

### Task 4: Wire auto-label + botPaused guard + takeover into automate.ts

**Files:**
- `apps/ingest/src/automate.ts`
- `apps/ingest/src/automate.test.ts`

- [ ] Modify `automate.ts` to load the `AiActionConfig`, run auto-label first, early-return on `botPaused`, then run takeover before the existing keyword/Claude logic. Replace the body of `automate` accordingly:

```ts
import { sendViaInstance } from "@evo/send";
import { claudeReply } from "@evo/ai";
import { decrypt } from "@evo/crypto";
import { applyAutoLabel, detectAndApplyTakeover, writeBotLog } from "./ai-actions.js";
import type { AutoLabelConfig, HumanTakeoverConfig } from "./ai-actions.js";

// ... resolveWorkspaceAiKey + AutomateInput unchanged ...

export async function automate(input: AutomateInput): Promise<void> {
  const { prisma } = await import("@evo/db");
  const chatbot = await prisma.chatbot.findUnique({
    where: { instanceId: input.instanceId },
    include: { triggers: true, aiActionConfig: true },
  });
  if (!chatbot || !chatbot.enabled || chatbot.pauseBot) return;

  const ctx = {
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
    contactPhone: input.contactPhone,
    inboundText: input.inboundText,
  };

  // 1. Auto-label always runs (even if the convo is later paused).
  if (chatbot.aiActionConfig) {
    await applyAutoLabel(ctx, chatbot.aiActionConfig.autoLabel as unknown as AutoLabelConfig);
  }

  // 2. If a human already took over this conversation, the bot stays silent.
  const conv = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (conv?.botPaused) return;

  // 3. Human takeover detection — if it fires (and pauses), stop here.
  if (chatbot.aiActionConfig) {
    const tookOver = await detectAndApplyTakeover(ctx, chatbot.aiActionConfig.humanTakeover as unknown as HumanTakeoverConfig);
    if (tookOver) return;
  }

  // 4. Existing keyword + Claude fallback (unchanged below) ...
  const text = input.inboundText.trim();
  const matched = chatbot.triggers.find((t) => keywordMatches(text, t.keyword, t.matchType));
  if (matched) {
    await sendViaInstance(input.instanceId, { type: "text", to: input.contactPhone, text: matched.response, userId: null });
    await writeBotLog(ctx, "trigger_matched", { keyword: matched.keyword });
    return;
  }
  if (chatbot.fallbackProvider !== "claude" || !chatbot.fallbackModel) return;

  // ... existing recent-context build + claudeReply unchanged ...
  // after a successful reply send, add:
  //   await writeBotLog(ctx, "ai_reply", { model: chatbot.fallbackModel });
}
```
Keep the existing `keywordMatches` helper and the Claude context-building block; only add the `writeBotLog(ctx, "ai_reply", …)` call after the final `sendViaInstance`.

- [ ] Extend `automate.test.ts` (the reset() helper must also clear new tables) with two cases:

```ts
// in reset():
await prisma.botUserLog.deleteMany();
await prisma.aiActionConfig.deleteMany();

it("does NOT reply when conversation.botPaused is true", async () => {
  const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
  await prisma.keywordTrigger.create({ data: { chatbotId: cb.id, keyword: "hello", matchType: "exact", response: "Hi!" } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { botPaused: true } });
  await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hello" });
  expect(mockedSend).not.toHaveBeenCalled();
});

it("takeover keyword pauses the bot and notifies the agent", async () => {
  const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
  await prisma.aiActionConfig.create({
    data: {
      workspaceId, chatbotId: cb.id,
      autoLabel: { enabled: false, rules: [] },
      humanTakeover: {
        enabled: true, triggerKeywords: ["agent"], notifyType: "whatsapp_number",
        notifyTargets: ["60999"], agentMessageTemplate: "Help {{user_phone}}",
        disableBotOnTakeover: true, userMessage: "One moment.",
      },
      autoFollowUp: { enabled: false, steps: [] },
    },
  });
  await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "get me an agent" });
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.botPaused).toBe(true);
  expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999" }));
});
```

- [ ] Run: `pnpm --filter @evo/ingest test`. Expected: all prior automate tests still green + 2 new passing.

- [ ] **Commit:** `feat(ingest): wire auto-label, botPaused guard, takeover into automate`.

---

### Task 5: Auto Follow-Up enrolment (REUSE the Drip engine)

**Decision (record in the commit body):** **Reuse `DripCampaign`/`DripEnrolment`** rather than add a parallel `FollowUpEnrolment`. Rationale: `DripEnrolment` already has `currentStep`, `nextRunAt`, `status`, the `@@index([workspaceId, status, nextRunAt])` the tick needs, and the `@@unique([campaignId, contactId])` idempotency we want. A follow-up is structurally a drip with a `lastSenderFilter` gate. We materialise one hidden `DripCampaign` per chatbot (named `__followup__<chatbotId>`, `triggerType=manual`, `active=false` so the existing `drip-tick` ignores it) and enrol contacts into it; a **separate** `follow-up-tick` (Task 6) processes only these rows so we can apply the `lastSenderFilter` + per-step text from `AiActionConfig.autoFollowUp` without polluting drip semantics. This avoids a duplicate table and a duplicate index while keeping the two ticks cleanly separated.

**Files:**
- `apps/ingest/src/ai-actions.ts` (extend)
- `apps/ingest/src/ai-actions.test.ts` (extend)

- [ ] Append `enrolFollowUp` to `ai-actions.ts`:

```ts
const FOLLOWUP_CAMPAIGN_PREFIX = "__followup__";

/** Enrol the contact into the chatbot's follow-up sequence if the last-sender gate passes. */
export async function enrolFollowUp(
  ctx: ActionCtx,
  chatbotId: string,
  cfg: AutoFollowUpConfig,
  lastSender: "chatbot" | "customer",
): Promise<boolean> {
  if (!cfg.enabled || cfg.steps.length === 0) return false;
  if (cfg.lastSenderFilter !== lastSender) return false;

  const { prisma } = await import("@evo/db");
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  if (!contact) return false;

  // Optional contactGroup/label gating.
  if (cfg.conditions?.labelIds?.length) {
    const hit = await prisma.contactLabel.count({ where: { contactId: contact.id, labelId: { in: cfg.conditions.labelIds } } });
    if (hit === 0) return false;
  }

  const name = FOLLOWUP_CAMPAIGN_PREFIX + chatbotId;
  const campaign = await prisma.dripCampaign.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
    create: {
      workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, name,
      triggerType: "manual", active: false,
      steps: cfg.steps as unknown as object,
    },
    update: { steps: cfg.steps as unknown as object, instanceId: ctx.instanceId },
  });

  const firstDelayMs = (cfg.steps[0]!.delaySeconds ?? 0) * 1000;
  await prisma.dripEnrolment.upsert({
    where: { campaignId_contactId: { campaignId: campaign.id, contactId: contact.id } },
    create: {
      workspaceId: ctx.workspaceId, campaignId: campaign.id, contactId: contact.id,
      currentStep: 0, status: "active", nextRunAt: new Date(Date.now() + firstDelayMs),
    },
    update: {}, // already enrolled — do not reset their progress
  });
  return true;
}
```
**Note:** `DripCampaign` has no `@@unique([workspaceId, name])` yet — add it in Task 5's schema touch-up (the `dripCampaign.upsert` above needs it):

```prisma
// in model DripCampaign:
  @@unique([workspaceId, name])
```
Then run `pnpm --filter @evo/db exec prisma migrate dev --name followup_campaign_unique`.

- [ ] Extend `ai-actions.test.ts`:

```ts
const { enrolFollowUp } = await import("./ai-actions");

describe("enrolFollowUp", () => {
  const cfg = {
    enabled: true, lastSenderFilter: "customer" as const,
    conditions: { contactGroupIds: [], labelIds: [] },
    steps: [{ text: "Still there?", delaySeconds: 3600 }],
  };
  it("enrols when last sender matches the filter", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const ok = await enrolFollowUp({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "" }, cb.id, cfg, "customer");
    expect(ok).toBe(true);
    expect(await prisma.dripEnrolment.count()).toBe(1);
  });
  it("skips when lastSender does not match", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const ok = await enrolFollowUp({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "" }, cb.id, cfg, "chatbot");
    expect(ok).toBe(false);
  });
});
```
Add `await prisma.dripEnrolment.deleteMany(); await prisma.dripCampaign.deleteMany();` to this file's `beforeEach`.

- [ ] Wire enrolment into `automate.ts` after a successful bot/AI reply (last sender = chatbot) and at the end for unanswered customer messages (last sender = customer). Add after the trigger/AI sends:

```ts
if (chatbot.aiActionConfig) {
  const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
  // after bot replied → lastSender "chatbot"; if we fell through with no reply → "customer"
  await enrolFollowUp(ctx, chatbot.id, fu, repliedByBot ? "chatbot" : "customer");
}
```
(Track a local `let repliedByBot = false` set to `true` in the trigger/AI branches.)

- [ ] Run: `pnpm --filter @evo/ingest test`. Expected: enrolFollowUp block — 2 passing.

- [ ] **Commit:** `feat(ingest): auto follow-up enrolment via reused drip engine` (commit body: explain reuse decision above).

---

### Task 6: Follow-Up worker tick (mirror drip-tick)

**Files:**
- `apps/worker/src/follow-up-tick.ts` (new)
- `apps/worker/src/follow-up-tick.test.ts` (new)
- `apps/worker/src/index.ts` (register queue)

- [ ] Write `apps/worker/src/follow-up-tick.ts` — mirrors `drip-tick.ts` but reads only `__followup__` campaigns and uses per-step `text` + `delaySeconds`:

```ts
import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const BATCH_SIZE = 200;
const PREFIX = "__followup__";

interface FollowUpStep { text: string; delaySeconds: number; mediaAssetId?: string | null }

export async function runFollowUpTick(opts?: { now?: Date }): Promise<{ sent: number }> {
  const now = opts?.now ?? new Date();
  const due = await prisma.dripEnrolment.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: now },
      campaign: { name: { startsWith: PREFIX } },
    },
    include: { campaign: true, contact: true },
    take: BATCH_SIZE,
  });

  let sent = 0;
  for (const e of due) {
    const steps = (e.campaign.steps as unknown as FollowUpStep[]) ?? [];
    if (e.currentStep >= steps.length) {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { status: "completed", completedAt: now } });
      continue;
    }
    const step = steps[e.currentStep]!;
    try {
      await sendViaInstance(e.campaign.instanceId, { type: "text", to: e.contact.phoneE164, text: step.text, userId: null });
    } catch {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { status: "failed" } });
      continue;
    }
    await prisma.botUserLog.create({
      data: {
        workspaceId: e.workspaceId, instanceId: e.campaign.instanceId,
        contactId: e.contactId, kind: "follow_up_sent",
        detail: { step: e.currentStep, text: step.text },
      },
    });

    const nextIndex = e.currentStep + 1;
    if (nextIndex >= steps.length) {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { currentStep: nextIndex, status: "completed", completedAt: now } });
    } else {
      const nextDelayMs = (steps[nextIndex]?.delaySeconds ?? 0) * 1000;
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + nextDelayMs) } });
    }
    sent += 1;
  }
  return { sent };
}
```

- [ ] Write `apps/worker/src/follow-up-tick.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));
const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { runFollowUpTick } = await import("./follow-up-tick");
const mockedSend = vi.mocked(sendViaInstance);

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.botUserLog.deleteMany();
  await prisma.dripEnrolment.deleteMany();
  await prisma.dripCampaign.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
});

it("sends due follow-up step, logs and advances/completes", async () => {
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e-" + Date.now(), evolutionApiKey: "K" } });
  const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123" } });
  const camp = await prisma.dripCampaign.create({ data: { workspaceId: ws.id, instanceId: inst.id, name: "__followup__cb1", triggerType: "manual", active: false, steps: [{ text: "Ping!", delaySeconds: 0 }] } });
  await prisma.dripEnrolment.create({ data: { workspaceId: ws.id, campaignId: camp.id, contactId: c.id, currentStep: 0, status: "active", nextRunAt: new Date(Date.now() - 1000) } });

  const { sent } = await runFollowUpTick();
  expect(sent).toBe(1);
  expect(mockedSend).toHaveBeenCalledWith(inst.id, expect.objectContaining({ text: "Ping!" }));
  expect(await prisma.botUserLog.count({ where: { kind: "follow_up_sent" } })).toBe(1);
  const e = await prisma.dripEnrolment.findFirst();
  expect(e?.status).toBe("completed");
});

it("ignores normal (non-followup) drip campaigns", async () => {
  const ws = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e2-" + Date.now(), evolutionApiKey: "K" } });
  const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60124" } });
  const camp = await prisma.dripCampaign.create({ data: { workspaceId: ws.id, instanceId: inst.id, name: "Regular drip", triggerType: "manual", active: true, steps: [{ templateId: "t", delayMs: 0 }] } });
  await prisma.dripEnrolment.create({ data: { workspaceId: ws.id, campaignId: camp.id, contactId: c.id, currentStep: 0, status: "active", nextRunAt: new Date(Date.now() - 1000) } });
  const { sent } = await runFollowUpTick();
  expect(sent).toBe(0);
  expect(mockedSend).not.toHaveBeenCalled();
});
```

- [ ] Register the queue in `apps/worker/src/index.ts` (mirror the `drip-tick` block):

```ts
import { runFollowUpTick } from "./follow-up-tick.js";
// ...
const FOLLOWUP_TICK_QUEUE = "follow-up-tick";
const followUpTickQueue = new Queue(FOLLOWUP_TICK_QUEUE, { connection });
await followUpTickQueue.add("tick", {}, { repeat: { every: 60000 }, jobId: "follow-up-tick:repeat" });
new Worker(FOLLOWUP_TICK_QUEUE, async () => {
  const { sent } = await runFollowUpTick();
  if (sent > 0) log.info({ sent }, "follow-up tick sent");
}, { connection });
```

- [ ] Run: `pnpm --filter @evo/worker test`. Expected: 2 passing.

- [ ] **Commit:** `feat(worker): follow-up-tick processing reused drip enrolments`.

---

### Task 7: AI Actions API (GET/PUT AiActionConfig)

**Files:**
- `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/ai-actions/route.ts` (new)

- [ ] Write the route with nested zod validation matching the engine types exactly:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const autoLabelSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(z.object({
    contains: z.string().max(200),
    labelId: z.string().min(1),
    op: z.enum(["add", "remove"]),
  })).max(50),
});

const humanTakeoverSchema = z.object({
  enabled: z.boolean(),
  triggerKeywords: z.array(z.string().max(80)).max(50).default([]),
  notifyType: z.enum(["whatsapp_number", "whatsapp_group"]).default("whatsapp_number"),
  notifyTargets: z.array(z.string().max(40)).max(50).default([]),
  agentMessageTemplate: z.string().max(2000).default(""),
  disableBotOnTakeover: z.boolean().default(true),
  userMessage: z.string().max(2000).default(""),
});

const followUpStepSchema = z.object({
  text: z.string().max(4000),
  delaySeconds: z.number().int().min(0).max(60 * 60 * 24 * 30),
  mediaAssetId: z.string().nullable().optional(), // Plan 7 MediaPicker (optional until built)
});

const autoFollowUpSchema = z.object({
  enabled: z.boolean(),
  lastSenderFilter: z.enum(["chatbot", "customer"]).default("customer"),
  conditions: z.object({
    scheduleJson: z.unknown().optional(),
    contactGroupIds: z.array(z.string()).default([]),
    labelIds: z.array(z.string()).default([]),
    extra: z.unknown().optional(),
  }).default({ contactGroupIds: [], labelIds: [] }),
  steps: z.array(followUpStepSchema).max(20).default([]),
});

const putSchema = z.object({
  autoLabel: autoLabelSchema,
  humanTakeover: humanTakeoverSchema,
  autoFollowUp: autoFollowUpSchema,
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id }, include: { aiActionConfig: true } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    return NextResponse.json({ config: chatbot.aiActionConfig ?? null });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const config = await db.aiActionConfig.upsert({
      where: { chatbotId: id },
      create: { chatbotId: id, ...parsed.data },
      update: { ...parsed.data },
    });
    return NextResponse.json({ config });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```
Note: the tenant wrapper injects `workspaceId` on `upsert.create`/`update`/`where`; `chatbotId` is the `@unique` selector so the where clause is `{ chatbotId: id, workspaceId }` after injection — valid because `AiActionConfig` has both columns.

- [ ] Run: `pnpm --filter @evo/web exec tsc --noEmit` (or `pnpm --filter @evo/web build`). Expected: no type errors in the new route.

- [ ] **Commit:** `feat(web): AI Actions config API (GET/PUT)`.

---

### Task 8: Chatbot Settings API (extend chatbot PUT) + Logs API

**Files:**
- `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/route.ts` (extend `updateSchema` + PUT)
- `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/logs/route.ts` (new)

- [ ] Extend `updateSchema` in the existing chatbot `route.ts` with the new Settings fields (additive — keep existing fields):

```ts
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().max(2000).optional().nullable(),
  fallbackProvider: z.enum(["none", "claude", "openai"]).optional(),
  fallbackModel: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(4000).optional().nullable(),
  // --- Settings screenshot additions ---
  aiTemperature: z.number().min(0).max(2).optional().nullable(),
  aiContextLength: z.number().int().min(1).max(64).optional().nullable(),
  scheduleJson: z.any().optional().nullable(),
  pauseBot: z.boolean().optional(),
  unsubscribeKeyword: z.string().max(80).optional().nullable(),
  limiterJson: z.any().optional().nullable(),
  filterJson: z.any().optional().nullable(),
});
```
The existing `db.chatbot.update({ where: { id }, data: parsed.data })` already persists the extra fields; no further PUT change needed. Keep the existing `openai` → `501` guard.

- [ ] Write `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/logs/route.ts` (User Logs data source):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const querySchema = z.object({
  kind: z.enum(["trigger_matched", "ai_reply", "auto_label", "human_takeover", "follow_up_sent", "action_run"]).optional(),
  conversationId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const logs = await db.botUserLog.findMany({
      where: {
        instanceId: chatbot.instanceId,
        ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.take,
    });
    return NextResponse.json({ logs });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] Run: `pnpm --filter @evo/web exec tsc --noEmit`. Expected: clean.

- [ ] **Commit:** `feat(web): chatbot settings fields + User Logs API`.

---

### Task 9: UI — AI Actions, Chatbot Settings, User Logs pages

**Files:**
- `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/ai-actions/page.tsx` + `ai-actions-editor.tsx`
- `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/settings/page.tsx` + `settings-editor.tsx`
- `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/logs/page.tsx` + `logs-table.tsx`
- `apps/web/messages/en-GB.json` (+`aiActions` namespace)

All pages follow the established pattern: server `page.tsx` (`requireMember` + `tenantClient`, render a `"use client"` child).

- [ ] Add an `aiActions` namespace to `apps/web/messages/en-GB.json` (top level, sibling of `automation`):

```json
"aiActions": {
  "title": "AI Actions",
  "autoLabel": "Auto Label",
  "humanTakeover": "Human Takeover",
  "autoFollowUp": "Auto Follow-Up",
  "settings": "Chatbot Settings",
  "userLogs": "User Logs",
  "enabled": "Enabled",
  "status": "Status",
  "addRule": "Add rule",
  "labelToApply": "Label",
  "operation": "Operation",
  "containsText": "When message contains",
  "triggerKeywords": "Trigger keywords (comma-separated)",
  "notifyType": "Notification type",
  "notifyTargets": "Notify (numbers / group, comma-separated)",
  "agentMessage": "Message to agent(s) — use {{user_phone}}",
  "disableBot": "Disable chatbot when human takes over",
  "userMessage": "Message to user",
  "lastSender": "Last sender",
  "followUpText": "Follow-up text",
  "delaySeconds": "Delay (seconds)",
  "addStep": "Add follow-up step",
  "save": "Save",
  "general": "General Settings",
  "aiSettings": "AI Settings",
  "advanced": "Advanced AI Settings",
  "aiTemperature": "AI Temperature",
  "aiContextLength": "AI Context Length",
  "pauseBot": "Pause Bot",
  "unsubscribeKeyword": "Unsubscribe keyword",
  "logKind": "Kind",
  "logDetail": "Detail",
  "logTime": "Time",
  "noLogs": "No activity yet."
}
```

- [ ] `ai-actions/page.tsx` (server): load chatbot + config, load workspace labels (for the Auto Label `labelId` dropdown), render `<AiActionsEditor>`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import AiActionsEditor from "./ai-actions-editor";

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const chatbot = await db.chatbot.findUnique({ where: { instanceId: id }, include: { aiActionConfig: true } });
  if (!chatbot) notFound();
  const labels = await db.label.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("aiActions.title")}</h1>
      <AiActionsEditor
        workspaceSlug={workspaceSlug}
        chatbotId={chatbot.id}
        labels={labels.map((l) => ({ id: l.id, name: l.name }))}
        initial={chatbot.aiActionConfig ? {
          autoLabel: chatbot.aiActionConfig.autoLabel as any,
          humanTakeover: chatbot.aiActionConfig.humanTakeover as any,
          autoFollowUp: chatbot.aiActionConfig.autoFollowUp as any,
        } : null}
      />
    </div>
  );
}
```

- [ ] `ai-actions-editor.tsx` (`"use client"`): three collapsible `<section>`s mirroring the screenshot. State holds the three config blobs; one `Save` PUTs to `/api/workspaces/${slug}/chatbots/${chatbotId}/ai-actions`. Key controls:
  - **Auto Label:** enable toggle; repeatable rows of `{ contains, labelId (select from `labels`), op (add/remove) }`; add/remove buttons.
  - **Human Takeover:** enable toggle; `triggerKeywords` text input (comma-split on save); `notifyType` select; `notifyTargets` text input (comma-split); `agentMessageTemplate` textarea with a `{{user_phone}}` hint; `disableBotOnTakeover` checkbox; `userMessage` textarea.
  - **Auto Follow-Up:** enable toggle; `lastSenderFilter` select (chatbot/customer); repeatable `steps` of `{ text (textarea), delaySeconds (number) }`; add/remove step. **Media:** render a disabled "Attach media (coming with Plan 7 MediaPicker)" placeholder; `mediaAssetId` stays `null`.

  Save handler shape:
```tsx
async function save() {
  const body = {
    autoLabel, // { enabled, rules: [...] }
    humanTakeover: {
      ...humanTakeover,
      triggerKeywords: keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      notifyTargets: targetsRaw.split(",").map((s) => s.trim()).filter(Boolean),
    },
    autoFollowUp, // { enabled, lastSenderFilter, conditions:{contactGroupIds:[],labelIds:[]}, steps:[...] }
  };
  const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/ai-actions`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  // toast on res.ok / res.status===400 VALIDATION
}
```

- [ ] `settings/page.tsx` + `settings-editor.tsx`: render **General** (pauseBot checkbox, unsubscribeKeyword, scheduleJson/limiterJson/filterJson as raw JSON textareas with parse-on-save), **AI Settings** (provider/model reuse, aiTemperature number 0–2, aiContextLength number), **Advanced** (placeholder collapsibles for AI Sensory Pack / Structured Reply marked "coming soon"). `Save` PUTs to the existing `/api/workspaces/${slug}/chatbots/${chatbotId}` endpoint with the new fields.

- [ ] `logs/page.tsx` + `logs-table.tsx`: server loads first page via `db.botUserLog.findMany`; client `logs-table.tsx` renders a table (Time / Kind / Detail) with a `kind` filter `<select>` that refetches `/api/workspaces/${slug}/chatbots/${chatbotId}/logs?kind=…`. Empty → `t("aiActions.noLogs")`.

- [ ] Add nav links from the chatbot editor page (`automation/chatbot/[id]/page.tsx`) to the three sub-pages (AI Actions / Settings / User Logs) — small tab row matching the left-nav order in the screenshot.

- [ ] Run: `pnpm --filter @evo/web build`. Expected: build succeeds, all three routes prerendered/compiled.

- [ ] **Commit:** `feat(web): AI Actions, Chatbot Settings, User Logs UI`.

---

### Task 10: e2e — takeover keyword pauses bot, notifies agent, halts replies

**Files:**
- `tests/e2e/ai-actions.spec.ts` (new, mirror existing automation e2e structure)

- [ ] Write a Playwright (or integration-style) test that drives the full takeover path. If the suite has no live Evolution, assert at the DB/engine boundary (mock `@evo/send`) as a deterministic integration test invoking `automate` end-to-end:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));
const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { automate } = await import("../../apps/ingest/src/automate");
const mockedSend = vi.mocked(sendViaInstance);

it("takeover keyword: pauses bot, notifies agent, and bot stops replying", async () => {
  // ... create workspace/instance/conversation/contact (as in ai-actions.test.ts) ...
  const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
  await prisma.keywordTrigger.create({ data: { chatbotId: cb.id, keyword: "hi", matchType: "exact", response: "Hello!" } });
  await prisma.aiActionConfig.create({ data: {
    workspaceId, chatbotId: cb.id,
    autoLabel: { enabled: false, rules: [] },
    humanTakeover: { enabled: true, triggerKeywords: ["agent"], notifyType: "whatsapp_number", notifyTargets: ["60999"], agentMessageTemplate: "Help {{user_phone}}", disableBotOnTakeover: true, userMessage: "One sec." },
    autoFollowUp: { enabled: false, steps: [] },
  } });

  // 1. customer asks for agent → takeover fires
  await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I want an agent" });
  expect((await prisma.conversation.findUnique({ where: { id: conversationId } }))?.botPaused).toBe(true);
  expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999", text: "Help 60123" }));
  expect(await prisma.botUserLog.count({ where: { kind: "human_takeover" } })).toBe(1);

  // 2. a follow-up "hi" (would normally trigger) must NOT reply because botPaused
  mockedSend.mockClear();
  await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
  expect(mockedSend).not.toHaveBeenCalled();
});
```

- [ ] Run the full affected suites:

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && \
  pnpm --filter @evo/ingest test && \
  pnpm --filter @evo/worker test && \
  pnpm --filter @evo/web exec tsc --noEmit
```
Expected: all green, no type errors.

- [ ] Final review against the self-review checklist below.

- [ ] **Commit:** `test(ai-actions): e2e takeover pauses bot + halts replies`.

---

## Self-Review Checklist

- [ ] Schema: `AiActionConfig` (1:1, `chatbotId @unique`), `BotUserLog`, `Conversation.botPaused`/`botPausedReason`, all 7 `Chatbot` settings fields added; both models in `TENANTED_MODELS`; `DripCampaign` has `@@unique([workspaceId, name])`.
- [ ] `BotUserLogKind` enum is exactly: `trigger_matched`, `ai_reply`, `auto_label`, `human_takeover`, `follow_up_sent`, `action_run` — and every engine writes the right kind.
- [ ] Config field names match across engine types, zod schemas, and UI (`autoLabel.rules[].{contains,labelId,op}`, `humanTakeover.{triggerKeywords,notifyType,notifyTargets,agentMessageTemplate,disableBotOnTakeover,userMessage}`, `autoFollowUp.{lastSenderFilter,conditions,steps[].{text,delaySeconds,mediaAssetId}}`).
- [ ] `automate.ts` order: auto-label → `botPaused` early-return → takeover → keyword → Claude → follow-up enrolment; existing keyword + Claude behaviour preserved; `chatbot.pauseBot` honoured.
- [ ] `botPaused` interaction: set by takeover (`disableBotOnTakeover`), checked at top of `automate`, complements (does not replace) the inbox `Assignment` model — agents in the three-pane UI keep replying manually while the bot is silent. (Add an "unpause bot" affordance to the inbox is noted as a follow-on, not in scope here.)
- [ ] Follow-Up reuses `DripCampaign`/`DripEnrolment`; `follow-up-tick` only touches `__followup__`-prefixed campaigns; `drip-tick` ignores them (they are `active:false`). No duplicate `FollowUpEnrolment` table created.
- [ ] All API routes: `requireMember` (Viewer for GET/logs, Admin for PUT), `tenantClient`, zod `safeParse` → `400 VALIDATION`, `AppError` → `{error:e.code}`.
- [ ] MediaPicker dependency (Plan 7) is optional: `mediaAssetId` nullable; UI shows a disabled placeholder; no hard import of an unbuilt component.
- [ ] All new files use ESM `.js` import specifiers; tests mock `@evo/send`/`@evo/ai` and clean new tables in `beforeEach`.
- [ ] Worker `index.ts` registers `follow-up-tick` with a 60s repeat, mirroring `drip-tick`.
- [ ] `en-GB.json` `aiActions` namespace covers every label used by the three pages.
- [ ] All commits include the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer; branch off the default branch before committing.
