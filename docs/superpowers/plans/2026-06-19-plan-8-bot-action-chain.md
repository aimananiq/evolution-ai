# Plan 8 — Chatbot Next Bot Action Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade per-instance chatbot keyword rules from "match → single text reply" into "match → an ordered action chain" matching the Wasapbot rule editor (General / Trigger / Content / Advanced). A matched `KeywordTrigger` now carries General metadata (name, description, audience, default-reply flag), Content (presence delay + optional media + text), and an ordered `actions` JSON array executed in sequence: send text/media, save the contact's next response, forward the inbound, add/remove labels, add/remove contact-group membership, call a REST API with a templated body, and chain to another rule ("Next Bot Action"). Multi-turn actions (`save_response`, `next_action`) park the conversation in a `BotPendingState` row so the contact's NEXT inbound message is routed correctly.

**Architecture:** The action chain is modelled as an ordered JSON array (`KeywordTrigger.actions Json`) validated by a zod discriminated union — simpler and more flexible than a child table, and the existing `DripCampaign.steps Json` already establishes the JSON-array-of-steps precedent in this codebase. A new shared package `@evo/flow-actions` holds the TS discriminated-union types + zod schema + the variable-templating helper so they are importable by both the ingest executor (server-side) and the web triggers API (validation) without a circular dependency. The executor itself (`apps/ingest/src/actions.ts`) lives in ingest because it depends on `@evo/send` (the send chokepoint) and `@evo/db` — putting it in `@evo/flow-actions` would force that package to depend on `@evo/send`, which we avoid. `automate.ts` gains a pre-match `BotPendingState` resolution step (resolve `save_response` → write into `Contact.customFields`; resolve `next_action` → route the inbound straight to the chained rule's actions) BEFORE keyword matching; on a fresh trigger match it calls `executeActions(...)` instead of the single `sendViaInstance`. The Claude fallback path is preserved untouched. UI replaces the flat trigger editor with a collapsible General/Trigger/Content/Advanced rule editor where each Advanced panel reads/writes one entry of the `actions` array.

**Tech Stack:** Inherits Plans 0–6.5. Adds: `@evo/flow-actions` (new workspace package, zod only). No new third-party deps. `fetch` (Node 22 global) for the `rest_api` action.

**Depends on:** Plan 7 (MediaAsset + `<MediaPicker>`) for the media side of `send_text` (`mediaAssetId`) and the Content panel's media picker. **Plan 7 is NOT yet implemented** (no `MediaAsset` model in `schema.prisma`, no `<MediaPicker>` component, and `sendViaInstance`/`MessageApi` are text-only). Therefore every media touchpoint in this plan is built to **degrade gracefully**: `mediaAssetId` is an optional nullable string column with no FK to `MediaAsset` (added as a plain column now; the FK is a one-line follow-up once Plan 7 lands), the executor logs-and-skips the media branch when no media-send capability exists, and the Content panel renders a disabled "Media (requires Plan 7)" stub instead of `<MediaPicker>`. Tasks 1, 3, and 7 each call out the exact stub and the exact line to un-stub later.

**Definition of done:**
1. An admin can build a rule with General/Trigger/Content fields plus an ordered list of Advanced actions, persisted on the trigger.
2. An inbound message matching the rule's keyword executes the action chain in order: text replies sent via `sendViaInstance`, labels upserted, group memberships upserted, inbound forwarded, REST API called with a templated body.
3. A rule with a `save_response` action parks a `BotPendingState`; the contact's next inbound message is stored into `Contact.customFields[key]` instead of re-matching keywords.
4. A rule with a `next_action` action parks a `BotPendingState`; the contact's next inbound message is routed to the chained rule (matched by keyword) and its actions run.
5. Variable templating (`{{contact.name}}`, `{{contact.phone}}`, `{{response}}`) is applied to `send_text` text and `rest_api` body.
6. The triggers API accepts + validates the new fields and `actions` array; GET stays backward-compatible (still returns `keyword`, `matchType`, `response`).
7. All previous tests pass; new tests added: action zod schema 3+, templating 3+, executor (one per action type) 7+, automate pending-state 3+, triggers route 2+, e2e 1.

**Spec reference:** Wasapbot reference screenshots `~/Downloads/clone features/WhatsApp Chatbot Index Update Jun 19 Screenshot (1).png` (rule editor + action chain) and `WhatsApp Chatbot Screenshot Jun 19.png` (Chatbot left nav). Extends Plan 4 (`docs/superpowers/plans/2026-06-18-plan-4-automation.md`).

---

## File Structure

```
/
├─ packages/
│  ├─ db/prisma/schema.prisma                                       # MODIFIED: extend KeywordTrigger; + enum TriggerAudience, enum BotPendingKind, model BotPendingState
│  ├─ db/prisma/migrations/<ts>_bot_action_chain/migration.sql      # NEW
│  ├─ db/src/tenant.ts                                              # MODIFIED: + BotPendingState
│  └─ flow-actions/                                                 # NEW package @evo/flow-actions
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts                                                # re-exports
│        ├─ types.ts                                                # discriminated union + actionsSchema (zod)
│        ├─ types.test.ts                                           # zod validation tests
│        ├─ template.ts                                             # renderTemplate(str, vars)
│        └─ template.test.ts
├─ apps/
│  ├─ ingest/
│  │  ├─ package.json                                               # MODIFIED: + @evo/flow-actions
│  │  └─ src/
│  │     ├─ actions.ts                                              # NEW: executeActions(ctx, actions)
│  │     ├─ actions.test.ts                                         # NEW (real DB + mocked send/fetch)
│  │     ├─ automate.ts                                             # MODIFIED: pending-state resolution + executeActions
│  │     └─ automate.test.ts                                        # MODIFIED: + pending-state tests
│  └─ web/
│     ├─ messages/en-GB.json                                        # MODIFIED: automation.rule.* keys
│     └─ src/app/
│        ├─ api/workspaces/[slug]/chatbots/[id]/triggers/route.ts             # MODIFIED: + fields + actions
│        ├─ api/workspaces/[slug]/chatbots/[id]/triggers/[triggerId]/route.ts # MODIFIED: + fields + actions
│        └─ [workspaceSlug]/automation/chatbot/[id]/
│           ├─ page.tsx                                             # MODIFIED: pass labels + lists + full trigger shape
│           ├─ editor.tsx                                           # MODIFIED: link each trigger to rule editor
│           ├─ rule-editor.tsx                                      # NEW: General/Trigger/Content/Advanced editor
│           └─ action-panels.tsx                                    # NEW: one panel component per action type
└─ tests/e2e/bot-action-chain.spec.ts                              # NEW: add_labels + send_text rule, inbound, assert
```

---

### Task 1: Schema — extend KeywordTrigger, add BotPendingState

**Files:** modify `packages/db/prisma/schema.prisma`, new migration, modify `packages/db/src/tenant.ts`.

- [ ] **Step 1: Add enums + extend `KeywordTrigger` in `packages/db/prisma/schema.prisma`.**

Add these two enums next to `enum KeywordMatchType` (around line 413):

```prisma
enum TriggerAudience {
  all
  individual
  group
}

enum BotPendingKind {
  save_response
  next_action
}
```

Replace the existing `model KeywordTrigger { ... }` (lines 450–461) with:

```prisma
model KeywordTrigger {
  id              String           @id @default(cuid())
  chatbotId       String
  keyword         String
  matchType       KeywordMatchType @default(contains)
  response        String
  // General (Wasapbot "Chatbot | General")
  name            String?
  description     String?
  sendTo          TriggerAudience  @default(all)
  isDefaultReply  Boolean          @default(false)
  // Content (Wasapbot "Chatbot | Content")
  presenceDelaySec Int             @default(0)
  mediaAssetId    String?          // Plan 7 dependency: plain column now, FK to MediaAsset added once Plan 7 lands
  // Advanced (Wasapbot "Chatbot | Advanced") — ordered action chain
  actions         Json             @default("[]")
  createdAt       DateTime         @default(now())

  chatbot Chatbot @relation(fields: [chatbotId], references: [id], onDelete: Cascade)

  @@index([chatbotId])
}
```

- [ ] **Step 2: Add `BotPendingState` model.** Append after `KeywordTrigger`:

```prisma
model BotPendingState {
  id             String         @id @default(cuid())
  workspaceId    String
  conversationId String
  contactPhone   String
  kind           BotPendingKind
  payload        Json           @default("{}")
  expiresAt      DateTime
  createdAt      DateTime       @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([conversationId])
  @@index([workspaceId, expiresAt])
}
```

The `@@unique([conversationId])` means a conversation can have at most one pending state at a time (a new park overwrites the old via upsert).

- [ ] **Step 3: Wire the back-relation on `Workspace`.** Find `model Workspace { ... }` and add to its relation block (alongside the existing relations such as `chatbots`, `contacts`):

```prisma
  botPendingStates BotPendingState[]
```

- [ ] **Step 4: Add `BotPendingState` to `TENANTED_MODELS` in `packages/db/src/tenant.ts`.** Inside the `new Set<string>([ ... ])` add the line `"BotPendingState",` after `"Chatbot",`. (Note: `KeywordTrigger` deliberately stays OUT of `TENANTED_MODELS` and gains no `workspaceId` — it is reached via raw `prisma` after a tenant-scoped `chatbot` ownership check, exactly as Plan 4 does today.)

- [ ] **Step 5: Generate the migration.** From repo root with env sourced:

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && set -a && . ./.env && set +a && pnpm --filter @evo/db exec prisma migrate dev --name bot_action_chain
```

Expected output ends with `Your database is now in sync with your schema.` and a new dir `packages/db/prisma/migrations/<ts>_bot_action_chain/`.

- [ ] **Step 6: Regenerate the client + typecheck db.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/db exec prisma generate && pnpm --filter @evo/db typecheck
```

Expected: `Generated Prisma Client` then no TS errors.

- [ ] **Step 7: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(db): bot action chain schema — KeywordTrigger fields + BotPendingState

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `@evo/flow-actions` package — action types + zod schema

**Files:** new package `packages/flow-actions/{package.json,tsconfig.json}`, `packages/flow-actions/src/{index.ts,types.ts,types.test.ts}`.

**Rationale (where the types live):** the discriminated union + zod schema go in a small shared package (NOT inline in ingest) so the web triggers API can import the SAME schema for request validation without pulling in ingest's server-only deps (`@evo/send`, `@evo/ai`). The package depends only on `zod`. The executor stays in ingest (Task 3) because it needs `@evo/send` + `@evo/db`.

- [ ] **Step 1: `packages/flow-actions/package.json`.**

```json
{
  "name": "@evo/flow-actions",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: `packages/flow-actions/tsconfig.json`.**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/flow-actions/src/types.ts` — the discriminated union + schema.** Action type list (settled): `send_text`, `save_response`, `forward_message`, `add_labels`, `remove_labels`, `add_to_group`, `remove_from_group`, `rest_api`, `next_action`.

```ts
import { z } from "zod";

export const sendTextActionSchema = z.object({
  type: z.literal("send_text"),
  text: z.string().min(1).max(4000),
  presenceDelaySec: z.number().int().min(0).max(30).default(0),
  mediaAssetId: z.string().nullable().default(null), // Plan 7: resolved to media once available
});

export const saveResponseActionSchema = z.object({
  type: z.literal("save_response"),
  // key under Contact.customFields to store the contact's NEXT inbound message
  fieldKey: z.string().min(1).max(80),
  prompt: z.string().max(4000).optional(), // optional text sent asking for the response
});

export const forwardMessageActionSchema = z.object({
  type: z.literal("forward_message"),
  mode: z.enum(["all", "rotator"]).default("all"),
  // "all": forward to every number; "rotator": round-robin one number per inbound
  numbers: z.array(z.string().min(5).max(20)).min(1),
});

export const addLabelsActionSchema = z.object({
  type: z.literal("add_labels"),
  labelIds: z.array(z.string()).min(1),
});

export const removeLabelsActionSchema = z.object({
  type: z.literal("remove_labels"),
  labelIds: z.array(z.string()).min(1),
});

export const addToGroupActionSchema = z.object({
  type: z.literal("add_to_group"),
  listIds: z.array(z.string()).min(1),
});

export const removeFromGroupActionSchema = z.object({
  type: z.literal("remove_from_group"),
  listIds: z.array(z.string()).min(1),
});

export const restApiActionSchema = z.object({
  type: z.literal("rest_api"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  bodyTemplate: z.string().max(8000).default(""), // templated with {{vars}}
});

export const nextActionActionSchema = z.object({
  type: z.literal("next_action"),
  // chain to another rule on this chatbot, matched by keyword on the contact's NEXT message
  keyword: z.string().min(1).max(80),
});

export const actionSchema = z.discriminatedUnion("type", [
  sendTextActionSchema,
  saveResponseActionSchema,
  forwardMessageActionSchema,
  addLabelsActionSchema,
  removeLabelsActionSchema,
  addToGroupActionSchema,
  removeFromGroupActionSchema,
  restApiActionSchema,
  nextActionActionSchema,
]);

export const actionsSchema = z.array(actionSchema).max(20);

export type BotAction = z.infer<typeof actionSchema>;
export type BotActionType = BotAction["type"];

/** Parse an unknown Json value into a validated action array; throws on invalid shape. */
export function parseActions(value: unknown): BotAction[] {
  if (value == null) return [];
  return actionsSchema.parse(value);
}
```

- [ ] **Step 4: `packages/flow-actions/src/index.ts`.**

```ts
export * from "./types";
export * from "./template";
```

- [ ] **Step 5: `packages/flow-actions/src/types.test.ts`.**

```ts
import { describe, it, expect } from "vitest";
import { actionsSchema, parseActions } from "./types";

describe("actionsSchema", () => {
  it("accepts a valid mixed chain and applies defaults", () => {
    const parsed = actionsSchema.parse([
      { type: "send_text", text: "Hi {{contact.name}}" },
      { type: "add_labels", labelIds: ["lbl_1"] },
      { type: "rest_api", url: "https://example.com/hook" },
    ]);
    expect(parsed[0]).toMatchObject({ type: "send_text", presenceDelaySec: 0, mediaAssetId: null });
    expect(parsed[2]).toMatchObject({ type: "rest_api", method: "POST", headers: {} });
  });

  it("rejects an unknown action type", () => {
    expect(() => actionsSchema.parse([{ type: "explode" }])).toThrow();
  });

  it("rejects send_text with empty text", () => {
    expect(() => actionsSchema.parse([{ type: "send_text", text: "" }])).toThrow();
  });

  it("parseActions(null) returns []", () => {
    expect(parseActions(null)).toEqual([]);
  });
});
```

- [ ] **Step 6: Install + test.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm install && pnpm --filter @evo/flow-actions test
```

Expected: `4 passed`.

- [ ] **Step 7: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(flow-actions): action discriminated-union zod schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Variable templating helper (TDD)

**Files:** `packages/flow-actions/src/template.ts`, `packages/flow-actions/src/template.test.ts`.

- [ ] **Step 1: Write `packages/flow-actions/src/template.test.ts` FIRST.**

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, type TemplateVars } from "./template";

const vars: TemplateVars = { contact: { name: "Aisha", phone: "60123456789" }, response: "blue" };

describe("renderTemplate", () => {
  it("substitutes contact + response tokens", () => {
    expect(renderTemplate("Hi {{contact.name}} ({{contact.phone}}) — {{response}}", vars)).toBe(
      "Hi Aisha (60123456789) — blue"
    );
  });

  it("tolerates surrounding whitespace inside braces", () => {
    expect(renderTemplate("Hi {{ contact.name }}", vars)).toBe("Hi Aisha");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(renderTemplate("X{{contact.email}}Y", vars)).toBe("XY");
  });

  it("leaves text with no tokens unchanged", () => {
    expect(renderTemplate("plain text", vars)).toBe("plain text");
  });
});
```

- [ ] **Step 2: Implement `packages/flow-actions/src/template.ts`.**

```ts
export interface TemplateVars {
  contact: { name: string; phone: string };
  response: string;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Replace {{contact.name}}, {{contact.phone}}, {{response}}; unknown tokens -> "". */
export function renderTemplate(input: string, vars: TemplateVars): string {
  const map: Record<string, string> = {
    "contact.name": vars.contact.name ?? "",
    "contact.phone": vars.contact.phone ?? "",
    response: vars.response ?? "",
  };
  return input.replace(TOKEN, (_m, key: string) => map[key] ?? "");
}
```

- [ ] **Step 3: Run.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/flow-actions test
```

Expected: `8 passed` (4 from Task 2 + 4 here).

- [ ] **Step 4: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(flow-actions): {{var}} templating helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Action executor `apps/ingest/src/actions.ts` (TDD, one test per action type)

**Files:** modify `apps/ingest/package.json`, new `apps/ingest/src/actions.ts`, new `apps/ingest/src/actions.test.ts`.

- [ ] **Step 1: Add the dep.** In `apps/ingest/package.json` add `"@evo/flow-actions": "workspace:*",` to `dependencies` (alphabetical, after `@evo/evolution-client`), then `pnpm install`.

- [ ] **Step 2: Implement `apps/ingest/src/actions.ts`.** The executor runs the chain in order. `save_response`/`next_action` are terminal-ish: they park a `BotPendingState` and stop processing further actions (the parked turn resumes in `automate.ts`).

```ts
import { sendViaInstance } from "@evo/send";
import { renderTemplate, type BotAction, type TemplateVars } from "@evo/flow-actions";

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ActionContext {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  contactName: string;
  contactId: string; // resolved upstream; "" if no Contact row
  inboundText: string;
}

function varsFor(ctx: ActionContext): TemplateVars {
  return {
    contact: { name: ctx.contactName, phone: ctx.contactPhone },
    response: ctx.inboundText,
  };
}

/** Run the action chain in order. Returns true if a pending state was parked (caller should stop). */
export async function executeActions(ctx: ActionContext, actions: BotAction[]): Promise<boolean> {
  const { prisma } = await import("@evo/db");
  const vars = varsFor(ctx);
  let rotatorIdx = 0;

  for (const action of actions) {
    switch (action.type) {
      case "send_text": {
        // Plan 7 STUB: mediaAssetId is ignored until sendViaInstance gains a media branch.
        // Un-stub: when Plan 7 lands, resolve action.mediaAssetId -> MediaAsset and pass {type:"media", ...}.
        await sendViaInstance(ctx.instanceId, {
          type: "text",
          to: ctx.contactPhone,
          text: renderTemplate(action.text, vars),
          userId: null,
        });
        break;
      }
      case "add_labels": {
        if (ctx.contactId) {
          for (const labelId of action.labelIds) {
            await prisma.contactLabel.upsert({
              where: { contactId_labelId: { contactId: ctx.contactId, labelId } },
              create: { contactId: ctx.contactId, labelId },
              update: {},
            });
          }
        }
        break;
      }
      case "remove_labels": {
        if (ctx.contactId) {
          await prisma.contactLabel.deleteMany({
            where: { contactId: ctx.contactId, labelId: { in: action.labelIds } },
          });
        }
        break;
      }
      case "add_to_group": {
        if (ctx.contactId) {
          for (const listId of action.listIds) {
            await prisma.contactListMember.upsert({
              where: { listId_contactId: { listId, contactId: ctx.contactId } },
              create: { listId, contactId: ctx.contactId },
              update: {},
            });
          }
        }
        break;
      }
      case "remove_from_group": {
        if (ctx.contactId) {
          await prisma.contactListMember.deleteMany({
            where: { contactId: ctx.contactId, listId: { in: action.listIds } },
          });
        }
        break;
      }
      case "forward_message": {
        const targets =
          action.mode === "rotator"
            ? [action.numbers[rotatorIdx++ % action.numbers.length]]
            : action.numbers;
        for (const to of targets) {
          await sendViaInstance(ctx.instanceId, {
            type: "text",
            to,
            text: `Forwarded from ${ctx.contactPhone}: ${ctx.inboundText}`,
            userId: null,
          });
        }
        break;
      }
      case "rest_api": {
        const body = renderTemplate(action.bodyTemplate, vars);
        try {
          await fetch(action.url, {
            method: action.method,
            headers: { "content-type": "application/json", ...action.headers },
            body: action.method === "GET" ? undefined : body || undefined,
          });
        } catch {
          // external endpoint failures must not break the chain
        }
        break;
      }
      case "save_response": {
        if (action.prompt) {
          await sendViaInstance(ctx.instanceId, {
            type: "text",
            to: ctx.contactPhone,
            text: renderTemplate(action.prompt, vars),
            userId: null,
          });
        }
        await parkPending(ctx, "save_response", { fieldKey: action.fieldKey });
        return true;
      }
      case "next_action": {
        await parkPending(ctx, "next_action", { keyword: action.keyword });
        return true;
      }
    }
  }
  return false;
}

async function parkPending(
  ctx: ActionContext,
  kind: "save_response" | "next_action",
  payload: Record<string, unknown>
): Promise<void> {
  const { prisma } = await import("@evo/db");
  await prisma.botPendingState.upsert({
    where: { conversationId: ctx.conversationId },
    create: {
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      contactPhone: ctx.contactPhone,
      kind,
      payload,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
    update: { kind, payload, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
}
```

- [ ] **Step 3: Write `apps/ingest/src/actions.test.ts` (real DB; mock send + global fetch).**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));

const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { executeActions } = await import("./actions");
const mockedSend = vi.mocked(sendViaInstance);

let workspaceId: string;
let instanceId: string;
let conversationId: string;
let contactId: string;

async function reset() {
  await prisma.botPendingState.deleteMany();
  await prisma.contactLabel.deleteMany();
  await prisma.contactListMember.deleteMany();
  await prisma.label.deleteMany();
  await prisma.contactList.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
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
    data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123", contactName: "Aisha" },
  });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123", name: "Aisha" } });
  workspaceId = ws.id; instanceId = inst.id; conversationId = conv.id; contactId = contact.id;
});

function ctx(over: Partial<Parameters<typeof executeActions>[0]> = {}) {
  return {
    workspaceId, instanceId, conversationId,
    contactPhone: "60123", contactName: "Aisha", contactId, inboundText: "blue",
    ...over,
  };
}

describe("executeActions", () => {
  it("send_text renders template vars and sends", async () => {
    await executeActions(ctx(), [{ type: "send_text", text: "Hi {{contact.name}}: {{response}}", presenceDelaySec: 0, mediaAssetId: null }]);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60123", text: "Hi Aisha: blue" }));
  });

  it("add_labels upserts ContactLabel rows", async () => {
    const lbl = await prisma.label.create({ data: { workspaceId, name: "VIP" } });
    await executeActions(ctx(), [{ type: "add_labels", labelIds: [lbl.id] }]);
    const links = await prisma.contactLabel.findMany({ where: { contactId } });
    expect(links).toHaveLength(1);
    expect(links[0].labelId).toBe(lbl.id);
  });

  it("remove_labels deletes the link", async () => {
    const lbl = await prisma.label.create({ data: { workspaceId, name: "VIP" } });
    await prisma.contactLabel.create({ data: { contactId, labelId: lbl.id } });
    await executeActions(ctx(), [{ type: "remove_labels", labelIds: [lbl.id] }]);
    expect(await prisma.contactLabel.count({ where: { contactId } })).toBe(0);
  });

  it("add_to_group upserts ContactListMember", async () => {
    const list = await prisma.contactList.create({ data: { workspaceId, name: "Leads" } });
    await executeActions(ctx(), [{ type: "add_to_group", listIds: [list.id] }]);
    expect(await prisma.contactListMember.count({ where: { contactId } })).toBe(1);
  });

  it("remove_from_group deletes membership", async () => {
    const list = await prisma.contactList.create({ data: { workspaceId, name: "Leads" } });
    await prisma.contactListMember.create({ data: { listId: list.id, contactId } });
    await executeActions(ctx(), [{ type: "remove_from_group", listIds: [list.id] }]);
    expect(await prisma.contactListMember.count({ where: { contactId } })).toBe(0);
  });

  it("forward_message sends to each number in 'all' mode", async () => {
    await executeActions(ctx(), [{ type: "forward_message", mode: "all", numbers: ["60999", "60888"] }]);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999" }));
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60888" }));
  });

  it("rest_api calls fetch with templated body", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await executeActions(ctx(), [{ type: "rest_api", method: "POST", url: "https://example.com/hook", headers: {}, bodyTemplate: '{"from":"{{contact.phone}}"}' }]);
    expect(f).toHaveBeenCalledWith("https://example.com/hook", expect.objectContaining({ method: "POST", body: '{"from":"60123"}' }));
    f.mockRestore();
  });

  it("save_response parks a BotPendingState and returns true", async () => {
    const parked = await executeActions(ctx(), [{ type: "save_response", fieldKey: "favColour" }]);
    expect(parked).toBe(true);
    const state = await prisma.botPendingState.findUnique({ where: { conversationId } });
    expect(state?.kind).toBe("save_response");
    expect((state?.payload as any).fieldKey).toBe("favColour");
  });

  it("next_action parks a BotPendingState with the chained keyword", async () => {
    const parked = await executeActions(ctx(), [{ type: "next_action", keyword: "menu" }]);
    expect(parked).toBe(true);
    const state = await prisma.botPendingState.findUnique({ where: { conversationId } });
    expect(state?.kind).toBe("next_action");
    expect((state?.payload as any).keyword).toBe("menu");
  });
});
```

- [ ] **Step 4: Run.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/ingest test -- actions
```

Expected: `9 passed`. (Requires the test Postgres on `:5433`; `test-setup.ts` runs `prisma migrate deploy` automatically.)

- [ ] **Step 5: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(ingest): action chain executor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire executor + pending-state resolution into `automate.ts` (TDD)

**Files:** modify `apps/ingest/src/automate.ts`, modify `apps/ingest/src/automate.test.ts`.

- [ ] **Step 1: Rewrite `apps/ingest/src/automate.ts`.** Add `contactName` to the input, resolve the `Contact` row, check `BotPendingState` BEFORE keyword matching, and call `executeActions` on a match. The Claude fallback path is unchanged.

```ts
import { sendViaInstance } from "@evo/send";
import { claudeReply } from "@evo/ai";
import { decrypt } from "@evo/crypto";
import { parseActions } from "@evo/flow-actions";
import { executeActions, type ActionContext } from "./actions";

const RECENT_LIMIT = 6;

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

export interface AutomateInput {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string | null;
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
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: input.workspaceId, phoneE164: input.contactPhone } },
  });
  const baseCtx: ActionContext = {
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
    contactPhone: input.contactPhone,
    contactName: contact?.name ?? input.contactName ?? "",
    contactId: contact?.id ?? "",
    inboundText: text,
  };

  // 1) Resolve any parked pending state for this conversation BEFORE keyword matching.
  const pending = await prisma.botPendingState.findUnique({ where: { conversationId: input.conversationId } });
  if (pending && pending.expiresAt > new Date()) {
    await prisma.botPendingState.delete({ where: { conversationId: input.conversationId } });
    if (pending.kind === "save_response") {
      const fieldKey = (pending.payload as any)?.fieldKey as string | undefined;
      if (fieldKey && contact) {
        const current = (contact.customFields as Record<string, unknown> | null) ?? {};
        await prisma.contact.update({
          where: { id: contact.id },
          data: { customFields: { ...current, [fieldKey]: text } },
        });
      }
      return;
    }
    if (pending.kind === "next_action") {
      const keyword = (pending.payload as any)?.keyword as string | undefined;
      const chained = keyword
        ? chatbot.triggers.find((t) => keywordMatches(keyword, t.keyword, "exact"))
        : undefined;
      if (chained) {
        await executeActions(baseCtx, parseActions(chained.actions));
      }
      return;
    }
  } else if (pending) {
    // expired — clear and fall through to normal matching
    await prisma.botPendingState.delete({ where: { conversationId: input.conversationId } });
  }

  // 2) Normal keyword matching → run the action chain (or legacy single response).
  const matched = chatbot.triggers.find((t) => keywordMatches(text, t.keyword, t.matchType));
  if (matched) {
    const actions = parseActions(matched.actions);
    if (actions.length > 0) {
      await executeActions(baseCtx, actions);
    } else {
      await sendViaInstance(input.instanceId, {
        type: "text",
        to: input.contactPhone,
        text: matched.response,
        userId: null,
      });
    }
    return;
  }

  // 3) Claude fallback (unchanged).
  if (chatbot.fallbackProvider !== "claude" || !chatbot.fallbackModel) return;

  const recent = await prisma.message.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { sentAt: "desc" },
    take: RECENT_LIMIT,
  });
  const context = recent.reverse().map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.body ?? "",
  }));

  const apiKey = await resolveWorkspaceAiKey(input.workspaceId, "claude");
  let reply: string;
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

- [ ] **Step 2: Update `apps/ingest/src/automate.test.ts`.** Keep all existing tests (legacy single-response path still passes because `actions` defaults to `[]`). Add a `botPendingState.deleteMany()` + `contact.deleteMany()` to `reset()`, and append three pending-state tests inside the `describe("automate", ...)` block:

```ts
  it("runs the action chain instead of single response when actions are present", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "hi", matchType: "exact", response: "legacy",
        actions: [{ type: "send_text", text: "Hi {{contact.name}}", presenceDelaySec: 0, mediaAssetId: null }] },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hi Aisha" }));
  });

  it("save_response: next inbound is stored into Contact.customFields, no keyword match", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const contact = await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({ data: { chatbotId: cb.id, keyword: "z", matchType: "exact", response: "x" } });
    await prisma.botPendingState.create({
      data: { workspaceId, conversationId, contactPhone: "60123", kind: "save_response",
        payload: { fieldKey: "favColour" }, expiresAt: new Date(Date.now() + 60000) },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "blue" });
    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect((updated?.customFields as any).favColour).toBe("blue");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(await prisma.botPendingState.count({ where: { conversationId } })).toBe(0);
  });

  it("next_action: next inbound is routed to the chained rule's actions", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "menu", matchType: "exact", response: "x",
        actions: [{ type: "send_text", text: "Here is the menu", presenceDelaySec: 0, mediaAssetId: null }] },
    });
    await prisma.botPendingState.create({
      data: { workspaceId, conversationId, contactPhone: "60123", kind: "next_action",
        payload: { keyword: "menu" }, expiresAt: new Date(Date.now() + 60000) },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "anything" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Here is the menu" }));
    expect(await prisma.botPendingState.count({ where: { conversationId } })).toBe(0);
  });
```

- [ ] **Step 3: Confirm the ingest caller passes `contactName`.** In `apps/ingest/src/index.ts` find the existing `automate({ ... })` call and ensure it includes `contactName` from the conversation/normalised event if available (it is optional, so this is non-breaking — add `contactName: <conversation/contact name>` if a name is in scope, otherwise leave as-is).

- [ ] **Step 4: Run the full ingest suite.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/ingest test
```

Expected: all prior ingest tests + the 9 actions tests + 3 new automate tests pass; the original 6 automate tests still green.

- [ ] **Step 5: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(ingest): pending-state resolution + action chain in automate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Triggers API — accept General/Content fields + actions array

**Files:** modify `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/triggers/route.ts` and `.../triggers/[triggerId]/route.ts`.

- [ ] **Step 1: Extend the POST schema + create in `triggers/route.ts`.** Replace the `const schema = ...` and the create call. Import `actionsSchema` from `@evo/flow-actions`.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { actionsSchema } from "@evo/flow-actions";

const schema = z.object({
  keyword: z.string().min(1).max(80),
  matchType: z.enum(["exact", "contains", "startsWith"]).default("contains"),
  response: z.string().min(1).max(4000),
  name: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  sendTo: z.enum(["all", "individual", "group"]).default("all"),
  isDefaultReply: z.boolean().default(false),
  presenceDelaySec: z.number().int().min(0).max(30).default(0),
  mediaAssetId: z.string().optional().nullable(),
  actions: actionsSchema.default([]),
});
```

Keep GET exactly as-is (it returns the full row via `findMany`, so new columns are additive and `keyword`/`matchType`/`response` are preserved — backward compatible). In POST, replace the `prisma.keywordTrigger.create({ data: { chatbotId: id, keyword: ..., matchType: ..., response: ... } })` with:

```ts
    const d = parsed.data;
    const trigger = await prisma.keywordTrigger.create({
      data: {
        chatbotId: id,
        keyword: d.keyword,
        matchType: d.matchType,
        response: d.response,
        name: d.name ?? null,
        description: d.description ?? null,
        sendTo: d.sendTo,
        isDefaultReply: d.isDefaultReply,
        presenceDelaySec: d.presenceDelaySec,
        mediaAssetId: d.mediaAssetId ?? null,
        actions: d.actions,
      },
    });
```

- [ ] **Step 2: Extend the PUT schema + update in `triggers/[triggerId]/route.ts`.** Import `actionsSchema` and make every field optional (partial update):

```ts
import { actionsSchema } from "@evo/flow-actions";

const schema = z.object({
  keyword: z.string().min(1).max(80).optional(),
  matchType: z.enum(["exact", "contains", "startsWith"]).optional(),
  response: z.string().min(1).max(4000).optional(),
  name: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  sendTo: z.enum(["all", "individual", "group"]).optional(),
  isDefaultReply: z.boolean().optional(),
  presenceDelaySec: z.number().int().min(0).max(30).optional(),
  mediaAssetId: z.string().nullable().optional(),
  actions: actionsSchema.optional(),
});
```

The existing `prisma.keywordTrigger.update({ where: { id: triggerId }, data: parsed.data })` already spreads `parsed.data` — since the schema now produces a partial object with the new optional keys, no further change to the update call is needed. The `actions` Json type is accepted directly by Prisma.

- [ ] **Step 3: Add `@evo/flow-actions` to the web app deps.** In `apps/web/package.json` add `"@evo/flow-actions": "workspace:*",` to `dependencies`, then `pnpm install`.

- [ ] **Step 4: Add a route test.** Create `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/triggers/route.test.ts` (follow the existing route-test pattern under `apps/web` — if none exists, place these as two assertions inside the e2e in Task 8 instead and tick this box noting that). Minimum coverage:
  - POST with `actions: [{ type: "add_labels", labelIds: ["x"] }]` → 201 and the persisted trigger has `actions` length 1.
  - POST with `actions: [{ type: "bogus" }]` → 400 `{ error: "VALIDATION" }`.

- [ ] **Step 5: Typecheck web.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/web typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(web): triggers API accepts general/content fields + action chain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rule editor UI — General / Trigger / Content / Advanced

**Files:** new `apps/web/.../automation/chatbot/[id]/rule-editor.tsx`, new `.../action-panels.tsx`, modify `.../page.tsx`, modify `.../editor.tsx`, modify `apps/web/messages/en-GB.json`.

The rule editor mirrors the Wasapbot screenshot: four sections — **Chatbot | General** (Status enable/disable via parent; Name; Description; Send to: All/Individual/Group), **Chatbot | Trigger** (Use as default reply Yes/No; Type: Contains keyword / Exact keyword; Keywords), **Chatbot | Content** (Presence Delay; Caption/Text; Media File — Plan 7 stub; Send Text Message), **Chatbot | Advanced** (collapsible action panels: Next Bot Action, User Response, Forward Message, Labels, Contact Group, REST API Data).

- [ ] **Step 1: Add i18n keys to `apps/web/messages/en-GB.json`** under the existing `automation` object, namespaced `automation.rule.*`:

```json
"rule": {
  "general": "Chatbot | General",
  "name": "Name",
  "description": "Description",
  "sendTo": "Send to",
  "sendToAll": "All",
  "sendToIndividual": "Individual",
  "sendToGroup": "Group",
  "trigger": "Chatbot | Trigger",
  "useAsDefault": "Use as default reply",
  "type": "Type",
  "typeContains": "Contains keyword",
  "typeExact": "Exact keyword",
  "keywords": "Keywords",
  "content": "Chatbot | Content",
  "presenceDelay": "Presence Delay (seconds)",
  "mediaFile": "Media File",
  "mediaRequiresPlan7": "Media attachments require the media library (coming soon)",
  "sendText": "Send Text Message",
  "advanced": "Chatbot | Advanced",
  "actionNextBot": "Next Bot Action",
  "actionUserResponse": "User Response",
  "actionForward": "Forward Message",
  "actionLabels": "Labels",
  "actionContactGroup": "Contact Group",
  "actionRestApi": "REST API Data",
  "addAction": "Add action",
  "removeAction": "Remove",
  "saveRule": "Save rule",
  "doNothing": "Do nothing",
  "saveResponse": "Save Response",
  "forwardAll": "Forward All",
  "rotator": "Rotator",
  "labelsToAdd": "Labels to Add",
  "labelsToRemove": "Labels to Remove",
  "contactsToAdd": "Contacts to Add (group)",
  "contactsToRemove": "Contacts to Remove (group)",
  "restDisabled": "Disabled",
  "restEnabled": "Enabled"
}
```

- [ ] **Step 2: Implement `action-panels.tsx`.** A controlled `ActionEditor` that, given the current `actions: BotAction[]` and the workspace's `labels`/`lists`, renders an "add action" dropdown and one editable card per action. Use the `BotAction` type from `@evo/flow-actions`.

```tsx
"use client";
import { useTranslations } from "next-intl";
import type { BotAction, BotActionType } from "@evo/flow-actions";

type Opt = { id: string; name: string };

const ADDABLE: BotActionType[] = [
  "send_text", "save_response", "forward_message",
  "add_labels", "remove_labels", "add_to_group", "remove_from_group",
  "rest_api", "next_action",
];

function emptyAction(type: BotActionType): BotAction {
  switch (type) {
    case "send_text": return { type, text: "", presenceDelaySec: 0, mediaAssetId: null };
    case "save_response": return { type, fieldKey: "" };
    case "forward_message": return { type, mode: "all", numbers: [""] };
    case "add_labels": return { type, labelIds: [] };
    case "remove_labels": return { type, labelIds: [] };
    case "add_to_group": return { type, listIds: [] };
    case "remove_from_group": return { type, listIds: [] };
    case "rest_api": return { type, method: "POST", url: "", headers: {}, bodyTemplate: "" };
    case "next_action": return { type, keyword: "" };
  }
}

export function ActionEditor({
  actions, onChange, labels, lists,
}: { actions: BotAction[]; onChange: (a: BotAction[]) => void; labels: Opt[]; lists: Opt[] }) {
  const t = useTranslations();
  const set = (i: number, next: BotAction) => onChange(actions.map((a, idx) => (idx === i ? next : a)));
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const add = (type: BotActionType) => onChange([...actions, emptyAction(type)]);

  return (
    <div className="space-y-3">
      <select className="border rounded p-2" value="" onChange={(e) => e.target.value && add(e.target.value as BotActionType)}>
        <option value="">{t("automation.rule.addAction")}…</option>
        {ADDABLE.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
      </select>
      {actions.map((a, i) => (
        <div key={i} className="border rounded p-3 space-y-2">
          <div className="flex justify-between"><strong>{a.type}</strong>
            <button className="text-red-600 text-sm underline" onClick={() => remove(i)}>{t("automation.rule.removeAction")}</button>
          </div>
          {a.type === "send_text" && (
            <>
              <textarea className="w-full border rounded p-2" rows={2} placeholder={t("automation.rule.sendText")} value={a.text} onChange={(e) => set(i, { ...a, text: e.target.value })} />
              <input type="number" className="border rounded p-2 w-32" min={0} max={30} value={a.presenceDelaySec} onChange={(e) => set(i, { ...a, presenceDelaySec: Number(e.target.value) })} />
            </>
          )}
          {a.type === "save_response" && (
            <input className="w-full border rounded p-2" placeholder="customField key" value={a.fieldKey} onChange={(e) => set(i, { ...a, fieldKey: e.target.value })} />
          )}
          {a.type === "forward_message" && (
            <>
              <select className="border rounded p-2" value={a.mode} onChange={(e) => set(i, { ...a, mode: e.target.value as "all" | "rotator" })}>
                <option value="all">{t("automation.rule.forwardAll")}</option>
                <option value="rotator">{t("automation.rule.rotator")}</option>
              </select>
              <input className="w-full border rounded p-2" placeholder="60xxxx,60yyyy" value={a.numbers.join(",")} onChange={(e) => set(i, { ...a, numbers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </>
          )}
          {(a.type === "add_labels" || a.type === "remove_labels") && (
            <select multiple className="w-full border rounded p-2 h-24" value={a.labelIds}
              onChange={(e) => set(i, { ...a, labelIds: Array.from(e.target.selectedOptions, (o) => o.value) })}>
              {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {(a.type === "add_to_group" || a.type === "remove_from_group") && (
            <select multiple className="w-full border rounded p-2 h-24" value={a.listIds}
              onChange={(e) => set(i, { ...a, listIds: Array.from(e.target.selectedOptions, (o) => o.value) })}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {a.type === "rest_api" && (
            <>
              <div className="flex gap-2">
                <select className="border rounded p-2" value={a.method} onChange={(e) => set(i, { ...a, method: e.target.value as any })}>
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input className="border rounded p-2 flex-1" placeholder="https://…" value={a.url} onChange={(e) => set(i, { ...a, url: e.target.value })} />
              </div>
              <textarea className="w-full border rounded p-2" rows={2} placeholder='{"from":"{{contact.phone}}"}' value={a.bodyTemplate} onChange={(e) => set(i, { ...a, bodyTemplate: e.target.value })} />
            </>
          )}
          {a.type === "next_action" && (
            <input className="w-full border rounded p-2" placeholder={t("automation.rule.keywords")} value={a.keyword} onChange={(e) => set(i, { ...a, keyword: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `rule-editor.tsx`** — the per-rule form with General/Trigger/Content/Advanced sections, wrapping `<ActionEditor>` and persisting via POST (new) / PUT (existing) to the triggers API. Props: `{ workspaceSlug, chatbotId, labels, lists, initial }` where `initial` is the full trigger shape or null. Save sends the full body (`keyword, matchType, response, name, description, sendTo, isDefaultReply, presenceDelaySec, mediaAssetId, actions`). The Content "Media File" block is the **Plan 7 STUB**:

```tsx
{/* Plan 7 STUB: replace with <MediaPicker value={mediaAssetId} onChange={setMediaAssetId} /> once Plan 7 lands */}
<div className="border rounded p-3 text-sm text-gray-500" aria-disabled>
  {t("automation.rule.mediaFile")}: {t("automation.rule.mediaRequiresPlan7")}
</div>
```

Section scaffolding (abbreviated for the General + Trigger + Content headers; Advanced renders `<ActionEditor>`):

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BotAction } from "@evo/flow-actions";
import { ActionEditor } from "./action-panels";

type Opt = { id: string; name: string };
type RuleInitial = {
  id?: string; keyword: string; matchType: "exact" | "contains" | "startsWith"; response: string;
  name: string | null; description: string | null; sendTo: "all" | "individual" | "group";
  isDefaultReply: boolean; presenceDelaySec: number; mediaAssetId: string | null; actions: BotAction[];
};

export default function RuleEditor({
  workspaceSlug, chatbotId, labels, lists, initial,
}: { workspaceSlug: string; chatbotId: string; labels: Opt[]; lists: Opt[]; initial: RuleInitial | null }) {
  const t = useTranslations();
  const router = useRouter();
  const [r, setR] = useState<RuleInitial>(initial ?? {
    keyword: "", matchType: "contains", response: "", name: null, description: null,
    sendTo: "all", isDefaultReply: false, presenceDelaySec: 0, mediaAssetId: null, actions: [],
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const url = r.id
      ? `/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers/${r.id}`
      : `/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers`;
    const res = await fetch(url, {
      method: r.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.general")}</h2>
        <input className="w-full border rounded p-2" placeholder={t("automation.rule.name")} value={r.name ?? ""} onChange={(e) => setR({ ...r, name: e.target.value || null })} />
        <textarea className="w-full border rounded p-2" rows={2} placeholder={t("automation.rule.description")} value={r.description ?? ""} onChange={(e) => setR({ ...r, description: e.target.value || null })} />
        <select className="border rounded p-2" value={r.sendTo} onChange={(e) => setR({ ...r, sendTo: e.target.value as RuleInitial["sendTo"] })}>
          <option value="all">{t("automation.rule.sendToAll")}</option>
          <option value="individual">{t("automation.rule.sendToIndividual")}</option>
          <option value="group">{t("automation.rule.sendToGroup")}</option>
        </select>
      </section>

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.trigger")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={r.isDefaultReply} onChange={(e) => setR({ ...r, isDefaultReply: e.target.checked })} />
          {t("automation.rule.useAsDefault")}
        </label>
        <select className="border rounded p-2" value={r.matchType} onChange={(e) => setR({ ...r, matchType: e.target.value as RuleInitial["matchType"] })}>
          <option value="contains">{t("automation.rule.typeContains")}</option>
          <option value="exact">{t("automation.rule.typeExact")}</option>
        </select>
        <input className="w-full border rounded p-2" placeholder={t("automation.rule.keywords")} value={r.keyword} onChange={(e) => setR({ ...r, keyword: e.target.value })} />
      </section>

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.content")}</h2>
        <input type="number" className="border rounded p-2 w-40" min={0} max={30} value={r.presenceDelaySec} onChange={(e) => setR({ ...r, presenceDelaySec: Number(e.target.value) })} />
        {/* Plan 7 STUB */}
        <div className="border rounded p-3 text-sm text-gray-500" aria-disabled>
          {t("automation.rule.mediaFile")}: {t("automation.rule.mediaRequiresPlan7")}
        </div>
        <textarea className="w-full border rounded p-2" rows={3} placeholder={t("automation.rule.sendText")} value={r.response} onChange={(e) => setR({ ...r, response: e.target.value })} />
      </section>

      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.advanced")}</h2>
        <ActionEditor actions={r.actions} onChange={(actions) => setR({ ...r, actions })} labels={labels} lists={lists} />
      </section>

      <button disabled={busy || !r.keyword || !r.response} onClick={save} className="bg-black text-white rounded p-2 px-4 disabled:opacity-50">
        {t("automation.rule.saveRule")}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update `page.tsx` to load labels + lists and pass the full trigger shape.** After the existing `chatbot` load, add:

```tsx
  const labels = await db.label.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const lists = await db.contactList.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
```

Pass `labels`, `lists` to `<Editor>` and include the new trigger fields (`name, description, sendTo, isDefaultReply, presenceDelaySec, mediaAssetId, actions`) in the `triggers.map(...)` mapping so the editor can hand them to `RuleEditor`.

- [ ] **Step 5: Wire `editor.tsx` to render `<RuleEditor>` per trigger.** Replace the flat inline trigger `<input>`s + `addTrigger` row with: a list of `<RuleEditor initial={...}>` for existing triggers and one `<RuleEditor initial={null}>` for adding a new rule, passing `labels`/`lists` through. The chatbot-level General/fallback section at the top stays. (Keep `removeTrigger` for deletion.)

- [ ] **Step 6: Typecheck + build web.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/web typecheck
```

Expected: no errors. (If `<MediaPicker>` from Plan 7 is later available, swap the two STUB blocks — this is the only UI change required to un-stub.)

- [ ] **Step 7: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "feat(web): chatbot rule editor with action-chain panels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: e2e — rule with add_labels + send_text, inbound webhook, assert

**Files:** new `tests/e2e/bot-action-chain.spec.ts`.

- [ ] **Step 1: Write the spec.** Follow the existing `tests/e2e/automation.spec.ts` patterns (sign-in helper, workspace bootstrap, the inbound-webhook simulation already used there). The flow:
  1. Sign in, open a chatbot for an instance, create a `Label` named "VIP" via the contacts/labels UI or seed it via API.
  2. In the rule editor: set keyword `vip`, match type Exact, response/text "Welcome VIP!", add an `add_labels` action selecting "VIP" and a `send_text` action "Hi {{contact.name}}". Save.
  3. Seed a `Contact` (phone `60123`) and a `Conversation` for the instance (via the same DB/API hooks the existing automation e2e uses).
  4. POST the inbound webhook payload (keyword `vip`) to the ingest webhook endpoint exactly as `automation.spec.ts` does.
  5. Assert: the contact now has the "VIP" `ContactLabel` (query via the contacts API/UI), AND an outbound message row / enqueued send exists for `60123` with text containing "Hi". Use the same assertion mechanism (`expect.poll`) the existing automation e2e uses for async ingest.

```ts
import { test, expect } from "@playwright/test";
// reuse helpers from the existing automation e2e (sign-in, seedContact, postInboundWebhook, etc.)
import { signIn, bootstrapWorkspaceWithInstance, postInboundWebhook } from "./helpers";

test("rule action chain: add_labels + send_text fire on keyword match", async ({ page, request }) => {
  const { workspaceSlug, instanceId } = await bootstrapWorkspaceWithInstance(page);
  await signIn(page, workspaceSlug);

  // create label
  const labelRes = await request.post(`/api/workspaces/${workspaceSlug}/labels`, { data: { name: "VIP" } });
  const { label } = await labelRes.json();

  // create rule via triggers API (UI is exercised separately; here we assert chain execution)
  // resolve chatbot id
  const cbRes = await request.post(`/api/workspaces/${workspaceSlug}/chatbots`, {
    data: { instanceId, enabled: true, fallbackProvider: "none" },
  });
  const { chatbot } = await cbRes.json();
  await request.post(`/api/workspaces/${workspaceSlug}/chatbots/${chatbot.id}/triggers`, {
    data: {
      keyword: "vip", matchType: "exact", response: "Welcome VIP!",
      actions: [
        { type: "add_labels", labelIds: [label.id] },
        { type: "send_text", text: "Hi {{contact.name}}" },
      ],
    },
  });

  // seed contact + conversation, then simulate inbound
  await postInboundWebhook(request, { instanceId, from: "60123", name: "Aisha", text: "vip" });

  // assert label applied
  await expect.poll(async () => {
    const c = await request.get(`/api/workspaces/${workspaceSlug}/contacts?phone=60123`);
    const { contacts } = await c.json();
    return contacts?.[0]?.labels?.some((l: any) => l.labelId === label.id || l.label?.name === "VIP") ?? false;
  }).toBe(true);

  // assert outbound enqueued (message row exists for the conversation)
  await expect.poll(async () => {
    const m = await request.get(`/api/workspaces/${workspaceSlug}/conversations`);
    const { conversations } = await m.json();
    return conversations?.some((cv: any) => cv.contactPhone === "60123") ?? false;
  }).toBe(true);
});
```

(If helper names differ in the existing e2e, adapt the imports/calls to match `tests/e2e/automation.spec.ts`; do not invent new endpoints.)

- [ ] **Step 2: Run e2e (or document the command if the e2e harness needs running services).**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm --filter @evo/web exec playwright test bot-action-chain
```

Expected: `1 passed`.

- [ ] **Step 3: Commit.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "test(e2e): bot action chain — labels + text on keyword

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final review

**Files:** none (review + full-suite run).

- [ ] **Step 1: Run the full test matrix.**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && pnpm -r typecheck && pnpm --filter @evo/flow-actions test && pnpm --filter @evo/ingest test
```

Expected: all green; flow-actions `8 passed`, ingest suite includes the 9 actions + 3 new automate tests + all prior tests.

- [ ] **Step 2: Self-review checklist (tick each):**
  - [ ] Action-type list is exactly the nine settled types and is identical across `types.ts`, the executor switch, `ADDABLE` in the UI, and the API schema: `send_text, save_response, forward_message, add_labels, remove_labels, add_to_group, remove_from_group, rest_api, next_action`.
  - [ ] Field names are consistent everywhere: `presenceDelaySec`, `mediaAssetId`, `actions`, `name`, `description`, `sendTo` (enum `TriggerAudience{all,individual,group}`), `isDefaultReply` on `KeywordTrigger`; `BotPendingState{workspaceId, conversationId, contactPhone, kind, payload, expiresAt}` with `kind` enum `BotPendingKind{save_response,next_action}`.
  - [ ] Multi-turn actions are modelled via `BotPendingState` (`@@unique([conversationId])`, 30-min TTL): `save_response` payload `{fieldKey}` → next inbound stored into `Contact.customFields[fieldKey]`; `next_action` payload `{keyword}` → next inbound routed to the chained rule's `actions`. `automate.ts` resolves pending state BEFORE keyword matching.
  - [ ] Backward compatibility preserved: triggers with empty `actions` still send `response` via the legacy path; the Claude fallback path is unchanged; triggers GET shape unchanged.
  - [ ] Plan 7 dependency stubbed in exactly three places, each with an un-stub note: `mediaAssetId` column (no FK), executor `send_text` media branch (ignored), Content panel media block (disabled stub) — and called out in the plan header.
  - [ ] `BotPendingState` added to `TENANTED_MODELS`; `KeywordTrigger` intentionally NOT (reached via raw `prisma` after tenant-scoped chatbot ownership check, matching Plan 4).
  - [ ] Action types + zod live in `@evo/flow-actions` (zod-only, importable by web + ingest); the executor lives in `apps/ingest/src/actions.ts` (needs `@evo/send`+`@evo/db`) — no circular dependency.
  - [ ] No placeholders: every step contains complete real code, real assertions, real commands with expected output, and a commit.

- [ ] **Step 3: Commit (if any review fixes were made).**

```bash
cd /Users/eb/conductor/workspaces/evolution/st-johns && git add -A && git commit -m "chore(plan-8): final review fixes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
```
