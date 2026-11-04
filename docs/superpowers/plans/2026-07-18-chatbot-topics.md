# Chatbot Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable chatbot "Topics" — each a self-contained assistant with persona, guardrails, and its own knowledge — that staff attach to any WhatsApp number.

**Architecture:** New `ChatTopic` Prisma model; `KnowledgeSnippet` gains `topicId`/`sourceType`/`sourceLabel`; `Chatbot` gains `topicId`. Pure logic (chunking, token metering, guardrail prompt assembly) lives in `@evo/kb` with vitest tests. The chatbot engine (`apps/ingest/src/automate.ts`) grounds replies in the assigned topic's knowledge and enforces guardrails. New web pages under `/automation/topics`. Fully backward-compatible: `topicId = null` keeps today's behaviour.

**Tech Stack:** Next.js 15 (app router), Prisma/PostgreSQL, TypeScript, Tailwind + shadcn kit, vitest, `@evo/kb` retrieval, `@evo/ai` `aiChat`, `unpdf` (PDF) + `mammoth` (Word) for document extraction.

---

## Reference patterns (read before starting)

- Prisma scoping: `packages/db/src/tenant.ts` (SCOPED_MODELS list — add new models here).
- Retrieval: `packages/kb/src/index.ts` (`retrieveContext`).
- Chatbot engine: `apps/ingest/src/automate.ts` (AI reply section ~line 178+; uses `resolveAiConfig(workspaceId, "chatbot")` + `aiChat`; handoff via `detectAndApplyTakeover` in `apps/ingest/src/ai-actions.ts`).
- Existing knowledge UI: `apps/web/src/app/[workspaceSlug]/settings/knowledge/`.
- UI kit: `@/components/ui/{page-header,empty-state,status-pill,card,button}`; a tabbed editor pattern in `apps/web/src/app/[workspaceSlug]/settings/integrations/ai/ai-scopes.tsx`.
- Migration flow: hand-write `packages/db/prisma/migrations/<ts>_<name>/migration.sql`, then `prisma migrate deploy`.

## File structure

**Create**
- `packages/db/prisma/migrations/20260719090000_chat_topics/migration.sql` — schema migration
- `packages/kb/src/chunk.ts` — text chunker + token/size estimate + meter tier
- `packages/kb/src/chunk.test.ts`
- `packages/kb/src/topic-prompt.ts` — guardrail-aware system-prompt builder
- `packages/kb/src/topic-prompt.test.ts`
- `apps/web/src/app/api/workspaces/[slug]/topics/route.ts` — list/create
- `apps/web/src/app/api/workspaces/[slug]/topics/[id]/route.ts` — get/update/delete
- `apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/route.ts` — list/create/bulk-delete snippets
- `apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/upload/route.ts` — PDF/Word → chunks
- `apps/web/src/app/api/workspaces/[slug]/topics/[id]/test/route.ts` — dry-run a reply
- `apps/web/src/app/[workspaceSlug]/automation/topics/page.tsx` — list
- `apps/web/src/app/[workspaceSlug]/automation/topics/topics-list.tsx` — client list + create
- `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/page.tsx` — editor loader
- `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx` — tabbed editor (Persona/Guardrails/Knowledge/Test)

**Modify**
- `packages/db/prisma/schema.prisma` — models
- `packages/db/src/tenant.ts` — scope `ChatTopic`
- `packages/kb/src/index.ts` — re-export chunk + topic-prompt
- `apps/ingest/src/automate.ts` — topic-aware grounding + guardrails
- `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/route.ts` — accept `topicId`
- `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/editor.tsx` — Topic dropdown
- `apps/web/src/components/shell/nav-config.tsx` — add Topics link (optional under Automation)
- `apps/web/messages/en-GB.json` — labels
- `apps/web/package.json` — add `unpdf`, `mammoth` (web upload route)

---

## Task 1: Schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260719090000_chat_topics/migration.sql`
- Modify: `packages/db/src/tenant.ts`

- [ ] **Step 1: Add models to schema.prisma**

Add to `Workspace`:
```prisma
  chatTopics           ChatTopic[]
```
Add new model + extend existing. Append near `KnowledgeSnippet`:
```prisma
model ChatTopic {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  personaTone String?
  greeting    String?
  guardrails  Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  snippets  KnowledgeSnippet[]
  chatbots  Chatbot[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}
```
In `KnowledgeSnippet` add:
```prisma
  topicId     String?
  sourceType  String   @default("faq")
  sourceLabel String?
  topic       ChatTopic? @relation(fields: [topicId], references: [id], onDelete: Cascade)
  // plus:
  @@index([topicId])
```
In `Chatbot` add:
```prisma
  topicId String?
  topic   ChatTopic? @relation(fields: [topicId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: Write migration SQL**

Create `packages/db/prisma/migrations/20260719090000_chat_topics/migration.sql`:
```sql
CREATE TABLE "ChatTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personaTone" TEXT,
    "greeting" TEXT,
    "guardrails" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatTopic_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatTopic_workspaceId_idx" ON "ChatTopic"("workspaceId");
CREATE UNIQUE INDEX "ChatTopic_workspaceId_name_key" ON "ChatTopic"("workspaceId", "name");
ALTER TABLE "ChatTopic" ADD CONSTRAINT "ChatTopic_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeSnippet" ADD COLUMN "topicId" TEXT;
ALTER TABLE "KnowledgeSnippet" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'faq';
ALTER TABLE "KnowledgeSnippet" ADD COLUMN "sourceLabel" TEXT;
CREATE INDEX "KnowledgeSnippet_topicId_idx" ON "KnowledgeSnippet"("topicId");
ALTER TABLE "KnowledgeSnippet" ADD CONSTRAINT "KnowledgeSnippet_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ChatTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chatbot" ADD COLUMN "topicId" TEXT;
ALTER TABLE "Chatbot" ADD CONSTRAINT "Chatbot_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ChatTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Scope ChatTopic in tenant.ts** — add `"ChatTopic",` to the SCOPED_MODELS array (near `"MediaFolder"`).

- [ ] **Step 4: Regenerate client**

Run: `pnpm --filter @evo/db generate`
Expected: "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/tenant.ts
git commit -m "feat(db): ChatTopic model + topic-scoped knowledge/chatbot"
```

---

## Task 2: Knowledge chunker + token meter (`@evo/kb`)

**Files:**
- Create: `packages/kb/src/chunk.ts`
- Test: `packages/kb/src/chunk.test.ts`
- Modify: `packages/kb/src/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/kb/src/chunk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { chunkText, estimateTokens, meterTier } from "./chunk";

describe("chunkText", () => {
  it("splits long text into ~maxChars chunks on paragraph/sentence bounds", () => {
    const para = "Sentence one. Sentence two. ".repeat(100); // ~2800 chars
    const chunks = chunkText(para, 800);
    expect(chunks.length).toBeGreaterThan(2);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(1000);
    expect(chunks.join(" ").replace(/\s+/g, "")).toContain("Sentenceone");
  });
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world", 800)).toEqual(["hello world"]);
  });
  it("drops empty input", () => {
    expect(chunkText("   ", 800)).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("meterTier", () => {
  it("green < 30k tokens, amber < 120k, red beyond", () => {
    expect(meterTier(10_000)).toBe("green");
    expect(meterTier(60_000)).toBe("amber");
    expect(meterTier(200_000)).toBe("red");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/kb exec vitest run src/chunk.test.ts`
Expected: FAIL — "Cannot find module './chunk'".

- [ ] **Step 3: Implement** — `packages/kb/src/chunk.ts`:
```ts
/** Split text into chunks of ~maxChars, breaking on paragraph then sentence bounds. */
export function chunkText(input: string, maxChars = 800): string[] {
  const text = (input ?? "").trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let buf = "";
  // Split on paragraphs first, then sentences, accumulating up to maxChars.
  const units = text.split(/\n\s*\n/).flatMap((p) => p.match(/[^.!?]+[.!?]?\s*/g) ?? [p]);
  for (const u of units) {
    if (buf.length + u.length > maxChars && buf) {
      parts.push(buf.trim());
      buf = "";
    }
    buf += u;
    while (buf.length > maxChars) {
      parts.push(buf.slice(0, maxChars).trim());
      buf = buf.slice(maxChars);
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean);
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

export type MeterTier = "green" | "amber" | "red";
/** Topic knowledge size guidance. */
export function meterTier(totalTokens: number): MeterTier {
  if (totalTokens < 30_000) return "green";
  if (totalTokens < 120_000) return "amber";
  return "red";
}
```

- [ ] **Step 4: Re-export from index** — add to `packages/kb/src/index.ts`:
```ts
export { chunkText, estimateTokens, meterTier, type MeterTier } from "./chunk";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @evo/kb exec vitest run src/chunk.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/chunk.ts packages/kb/src/chunk.test.ts packages/kb/src/index.ts
git commit -m "feat(kb): text chunker + token/meter helpers"
```

---

## Task 3: Guardrail system-prompt builder (`@evo/kb`)

**Files:**
- Create: `packages/kb/src/topic-prompt.ts`
- Test: `packages/kb/src/topic-prompt.test.ts`
- Modify: `packages/kb/src/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/kb/src/topic-prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildTopicSystemPrompt, type TopicGuardrails } from "./topic-prompt";

const base: TopicGuardrails = {
  stayOnTopic: true,
  answerOnlyFromKnowledge: true,
  handoff: { enabled: true, triggers: ["human"], onUnsure: true },
  neverSay: ["guaranteed scholarship"],
  fallbackMessage: "Let me connect you with our team.",
};

describe("buildTopicSystemPrompt", () => {
  it("includes persona, knowledge, and the anti-hallucination rule", () => {
    const p = buildTopicSystemPrompt({ personaTone: "polite, short", guardrails: base, knowledge: "Fees: RM5000." });
    expect(p).toContain("polite, short");
    expect(p).toContain("Fees: RM5000.");
    expect(p.toLowerCase()).toContain("only");
    expect(p).toContain("Let me connect you with our team.");
    expect(p).toContain("guaranteed scholarship");
  });
  it("omits the knowledge-only rule when disabled", () => {
    const p = buildTopicSystemPrompt({ guardrails: { ...base, answerOnlyFromKnowledge: false }, knowledge: "" });
    expect(p.toLowerCase()).not.toContain("only from the knowledge");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @evo/kb exec vitest run src/topic-prompt.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — `packages/kb/src/topic-prompt.ts`:
```ts
export interface TopicGuardrails {
  stayOnTopic: boolean;
  answerOnlyFromKnowledge: boolean;
  handoff: { enabled: boolean; triggers: string[]; onUnsure: boolean };
  neverSay: string[];
  fallbackMessage: string;
}

export const DEFAULT_GUARDRAILS: TopicGuardrails = {
  stayOnTopic: true,
  answerOnlyFromKnowledge: true,
  handoff: { enabled: true, triggers: ["talk to human", "agent", "complaint"], onUnsure: true },
  neverSay: [],
  fallbackMessage: "Let me connect you with our team — please hold on. 🙏",
};

export function buildTopicSystemPrompt(input: {
  personaTone?: string | null;
  guardrails: TopicGuardrails;
  knowledge: string;
}): string {
  const g = input.guardrails;
  const lines: string[] = [];
  lines.push("You are a WhatsApp customer-service assistant.");
  if (input.personaTone) lines.push(`Style: ${input.personaTone}.`);
  if (g.stayOnTopic) lines.push("Only answer questions within your topic. Politely decline anything off-topic and point the person to the right channel.");
  if (g.answerOnlyFromKnowledge) {
    lines.push("Answer ONLY from the KNOWLEDGE below. If the answer is not clearly in it, reply EXACTLY with the fallback message and nothing else. Never guess fees, dates, or make promises.");
  }
  if (g.neverSay.length) lines.push(`Never say any of the following: ${g.neverSay.map((s) => `"${s}"`).join(", ")}.`);
  lines.push(`Fallback message: "${g.fallbackMessage}"`);
  lines.push("");
  lines.push("KNOWLEDGE:");
  lines.push(input.knowledge?.trim() || "(no knowledge provided)");
  return lines.join("\n");
}

/** True if the inbound text should trigger a human handoff. */
export function shouldHandoff(text: string, g: TopicGuardrails): boolean {
  if (!g.handoff.enabled) return false;
  const t = (text ?? "").toLowerCase();
  return g.handoff.triggers.some((k) => k && t.includes(k.toLowerCase()));
}
```

- [ ] **Step 4: Re-export** — add to `packages/kb/src/index.ts`:
```ts
export { buildTopicSystemPrompt, shouldHandoff, DEFAULT_GUARDRAILS, type TopicGuardrails } from "./topic-prompt";
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @evo/kb exec vitest run src/topic-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/topic-prompt.ts packages/kb/src/topic-prompt.test.ts packages/kb/src/index.ts
git commit -m "feat(kb): guardrail-aware topic system-prompt builder"
```

---

## Task 4: Topics CRUD API

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/topics/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/topics/[id]/route.ts`

- [ ] **Step 1: Implement list/create** — `topics/route.ts`. Follow the exact shape of `api/workspaces/[slug]/media/folders/route.ts` (requireMember, tenantClient, zod). GET returns `{ topics: [{id,name, guardrails, personaTone, greeting, _count:{snippets, chatbots}}] }`. POST body `{ name: string(1..80) }`, create with `guardrails: DEFAULT_GUARDRAILS` (import from `@evo/kb`), role `Admin`. Return `{ topic }`.

- [ ] **Step 2: Implement get/update/delete** — `topics/[id]/route.ts`. GET one (with snippets summary). PATCH body `{ name?, personaTone?, greeting?, guardrails? }` (zod; guardrails validated as the `TopicGuardrails` shape). DELETE removes topic (cascade drops its snippets; chatbots' `topicId` → null via FK). Role `Admin`.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/workspaces/[slug]/topics
git commit -m "feat(api): topics CRUD"
```

---

## Task 5: Topic knowledge API (FAQ / paste / delete)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/route.ts`

- [ ] **Step 1: Implement.** GET → snippets for the topic `{ snippets: [{id,title,content,sourceType,sourceLabel,enabled, chars}], totalTokens }` (compute `estimateTokens` sum via `@evo/kb`). POST body one of:
  - `{ type: "faq", question: string, answer: string }` → 1 snippet `{ title: question, content: answer, sourceType: "faq" }`.
  - `{ type: "text", label?: string, content: string }` → `chunkText(content)` → N snippets sharing `sourceLabel`.
  DELETE query `?id=` (one snippet) or `?sourceLabel=` (whole upload group). Verify each snippet/topic belongs to the workspace (tenantClient). Role `Admin`.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/route.ts
git commit -m "feat(api): topic knowledge (faq/text) CRUD"
```

---

## Task 6: Document upload → chunks

**Files:**
- Modify: `apps/web/package.json` (add deps)
- Create: `apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/upload/route.ts`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @evo/web add unpdf mammoth`
Expected: package.json + lockfile updated.

- [ ] **Step 2: Implement upload route.** POST `multipart/form-data` with `file`. Accept `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; max 10 MB. Extract text:
```ts
// PDF:
import { extractText, getDocumentProxy } from "unpdf";
const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
const { text } = await extractText(pdf, { mergePages: true });
// Word:
import mammoth from "mammoth";
const { value: text } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
```
Then `chunkText(text)` → create N snippets `{ topicId, title: file.name + " #" + i, content: chunk, sourceType: "pdf", sourceLabel: file.name }`. Return `{ inserted: N, tokens }`. Role `Admin`. Guard: `runtime = "nodejs"` (Buffer needed) — add `export const runtime = "nodejs";`.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/app/api/workspaces/[slug]/topics/[id]/knowledge/upload/route.ts
git commit -m "feat(api): topic knowledge upload (pdf/word → chunks)"
```

---

## Task 7: Assign topic to a chatbot

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/route.ts`

- [ ] **Step 1: Add `topicId` to the PATCH schema** — `topicId: z.string().nullable().optional()`, and include it in the update `data`. If provided non-null, verify the topic exists in this workspace (tenantClient) else 404.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/workspaces/[slug]/chatbots/[id]/route.ts
git commit -m "feat(api): assign topic to chatbot"
```

---

## Task 8: Engine — topic-aware grounding + guardrails

**Files:**
- Modify: `apps/ingest/src/automate.ts`

- [ ] **Step 1: Load the topic when set.** After the chatbot is loaded and AI fallback is on, branch: if `chatbot.topicId`, load `prisma.chatTopic.findUnique` + its enabled snippets; else keep the legacy path (workspace-wide snippets + `chatbot.systemPrompt`).

- [ ] **Step 2: Handoff first (guardrail ③).** For the topic path, before calling the model: `import { shouldHandoff } from "@evo/kb";` — if `shouldHandoff(text, guardrails)` → run `detectAndApplyTakeover` (or its underlying tag+pause) with the fallback message, write a bot log, and `return`.

- [ ] **Step 3: Build the grounded prompt.** `const { block } = retrieveContext(text, topicSnippets);` then `const systemPrompt = buildTopicSystemPrompt({ personaTone: topic.personaTone, guardrails, knowledge: block });`. If `guardrails.answerOnlyFromKnowledge && !block` → send `guardrails.fallbackMessage` directly (skip the model) and return.

- [ ] **Step 4: Call the model** with the existing `aiChat({ provider: aiCfg.provider, ... , system: systemPrompt, messages })` path (already scoped to `"chatbot"`). Keep the existing try/catch → autoresponder fallback.

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @evo/ingest typecheck`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/ingest/src/automate.ts
git commit -m "feat(chatbot): topic-grounded replies + guardrails"
```

---

## Task 9: Topic test endpoint

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/topics/[id]/test/route.ts`

- [ ] **Step 1: Implement.** POST body `{ message: string }`. Load topic + snippets, resolve `resolveAiConfig(workspace.id, "chatbot")`, `retrieveContext(message, snippets)`, build the prompt, and either return the fallback (no knowledge) or call `aiChat`. Response `{ reply, usedSnippets: [{title}], fellBack: boolean }`. Role `Admin`. This mirrors the engine so staff preview before going live.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/workspaces/[slug]/topics/[id]/test/route.ts
git commit -m "feat(api): topic dry-run test endpoint"
```

---

## Task 10: Topics list page

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/automation/topics/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/automation/topics/topics-list.tsx`
- Modify: `apps/web/src/components/shell/nav-config.tsx`

- [ ] **Step 1: Page** — server component: `requireMember(slug, "Admin")`, load topics with counts, render `<PageHeader icon={Bot} title="Chatbot Topics" actions={<New>}>` + `<TopicsList>`. Follow `automation/chatbot/page.tsx` for structure and the kit.

- [ ] **Step 2: TopicsList client** — grid/list of `Card`s (name, "N knowledge entries", "used by N numbers", Open link) + a "New topic" button that `POST /topics` then routes to `/automation/topics/{id}`. `EmptyState` when none.

- [ ] **Step 3: Nav** — add `{ key: "topics", path: "/automation/topics", icon: Bot }` under the Automation group in `nav-config.tsx`, plus `topics: t("nav.topics")` in `layout.tsx` labels and `"topics": "Chatbot Topics"` in `messages/en-GB.json` nav block.

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/automation/topics" apps/web/src/components/shell/nav-config.tsx "apps/web/src/app/[workspaceSlug]/layout.tsx" apps/web/messages/en-GB.json
git commit -m "feat(web): topics list page + nav"
```

---

## Task 11: Topic editor — Persona + Guardrails tabs

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx`

- [ ] **Step 1: Loader page** — server component: load the topic + snippets summary + numbers using it; render `<PageHeader>` + `<TopicEditor initial=... />`. 404 via `notFound()` if missing.

- [ ] **Step 2: TopicEditor** — client, tabbed (reuse the pill-tabs pattern from `ai-scopes.tsx`): tabs **Persona**, **Guardrails**, **Knowledge**, **Test**.
  - **Persona:** name, `personaTone` input, greeting textarea → PATCH on Save.
  - **Guardrails:** checkboxes bound to `guardrails.{stayOnTopic, answerOnlyFromKnowledge, handoff.enabled, handoff.onUnsure}`, a comma/line list for `neverSay` and `handoff.triggers`, and a `fallbackMessage` textarea. Defaults pre-ticked. PATCH on Save. Include a one-line explainer under each (e.g. "Answer only from knowledge — stops the bot inventing fees/dates").

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/automation/topics/[id]"
git commit -m "feat(web): topic editor — persona + guardrails"
```

---

## Task 12: Topic editor — Knowledge tab (with meter)

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx`

- [ ] **Step 1: Knowledge tab UI.** Load `GET /topics/[id]/knowledge`. Show three "add" cards:
  - **FAQ:** question + answer → POST `{type:"faq"}`. Badge "🟢 most efficient & precise".
  - **Paste text:** label + textarea → POST `{type:"text"}`. Badge "🟢 efficient".
  - **Upload:** file input (PDF/Word) → POST to `/knowledge/upload` (FormData). Badge "🟡 convenient, can be token-heavy — trim to what customers ask".
  Below, list existing entries grouped by `sourceLabel` (FAQ shown individually) with size + a delete (× per item / per group).
- [ ] **Step 2: Meter.** Compute `totalTokens` from the API; render a bar using `meterTier` colors (🟢 Lean <30k / 🟡 Getting large / 🔴 Very large) with the reminder text from the spec. Note: "the bot only pulls the most relevant pieces per reply, so per-message cost stays bounded".
- [ ] **Step 3: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx"
git commit -m "feat(web): topic knowledge tab + token meter"
```

---

## Task 13: Topic editor — Test tab + Chatbot topic dropdown

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/editor.tsx`

- [ ] **Step 1: Test tab.** A message input + "Try" button → POST `/topics/[id]/test` → show the reply, a `fellBack` warning if it used the fallback, and the `usedSnippets` titles ("Answered using: …").

- [ ] **Step 2: Chatbot dropdown.** In the chatbot editor, add a **Topic** `<select>` bound to `topicId` (options loaded from `GET /topics` — pass topics via the page, or fetch client-side). When a topic is chosen, hide the raw `System prompt` + `Model override` fields (they now come from the topic). Save via the existing chatbot PATCH (now accepts `topicId`). Add a hint linking to the topic editor.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @evo/web typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx" "apps/web/src/app/[workspaceSlug]/automation/chatbot/[id]/editor.tsx"
git commit -m "feat(web): topic test panel + assign topic to number"
```

---

## Task 14: Full typecheck + deploy

**Files:** none (deploy)

- [ ] **Step 1: Typecheck all touched packages**

Run: `pnpm --filter @evo/kb typecheck && pnpm --filter @evo/web typecheck && pnpm --filter @evo/ingest typecheck && pnpm --filter @evo/kb exec vitest run`
Expected: all pass.

- [ ] **Step 2: Deploy (prod pattern).** rsync `packages/db/prisma`, `packages/kb/src`, `apps/web/src`, `apps/ingest/src`, `apps/web/package.json`, `pnpm-lock.yaml` to S4; `docker compose build web ingest`; run `prisma migrate deploy` from the fresh web image; `docker compose up -d web ingest`.

- [ ] **Step 3: Verify live.** Create a topic, add an FAQ + upload a PDF, check the meter, run the Test tab, assign it to a number, and confirm a real WhatsApp message gets a grounded reply (and a handoff trigger word pauses the bot).

- [ ] **Step 4: Commit** (if any deploy-config tweaks were needed).

---

## Self-review

**Spec coverage:** Topic library (T1,4,10,11) ✓; guardrails all six (T3 builder, T8 enforcement incl. handoff + fallback, T11 UI) ✓; knowledge FAQ/paste/PDF (T5,6) ✓; token meter + reminders (T2,12) ✓; test panel (T9,13) ✓; attach-to-number dropdown (T7,13) ✓; back-compat null topicId (T1,T8 legacy branch) ✓; URL/auto-routing correctly deferred ✓.

**Placeholder scan:** Core logic tasks (T1-3, 8) contain full code + tests. API/UI tasks (T4-7, 9-13) give exact endpoints, request/response shapes, field names, and the concrete pattern file to mirror — appropriate for this large existing codebase where inlining every line of ~10 CRUD/UI files would bloat the plan without adding signal. No "TBD"/"handle edge cases" left.

**Type consistency:** `TopicGuardrails` shape is identical across schema JSON (T1), builder (T3), API validation (T4/5), and UI (T11). `chunkText`/`estimateTokens`/`meterTier` names consistent (T2,5,6,12). `sourceType`/`sourceLabel` consistent (T1,5,6,12). `shouldHandoff`/`buildTopicSystemPrompt` used exactly as defined (T3,8,9).
