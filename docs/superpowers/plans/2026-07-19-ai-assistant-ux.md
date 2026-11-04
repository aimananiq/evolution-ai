# AI Assistant UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the confusing Topic + Chatbot split with one guided, theme-aware, jargon-free "AI Assistant" experience that can't end in a silently-broken state.

**Architecture:** A UX/orchestration layer over the existing `ChatTopic` / `Chatbot` / `KnowledgeSnippet` models — **no schema migration**. New pure mappers + a small "activate" orchestration (the atomic turn-on fix) + new API routes, then the wizard, assistant-home, and list pages. All UI uses the app's theme tokens (`hsl(var(--…))`).

**Tech Stack:** Next.js 15 app-router, React, NextAuth, Prisma (`tenantClient`), Tailwind + CSS-var theme tokens, Vitest, Playwright, `@evo/kb` (`DEFAULT_GUARDRAILS`, `meterTier`), `@evo/ai` (`resolveAiConfig`).

**Reference files to mirror (read before starting):**
- API pattern: `apps/web/src/app/api/workspaces/[slug]/chatbots/route.ts`, `.../topics/route.ts`, `.../topics/[id]/test/route.ts`
- Engine gate (why the fix matters): `apps/ingest/src/automate.ts:180-215`
- Existing UI to mirror: `apps/web/src/app/[workspaceSlug]/automation/topics/[id]/topic-editor.tsx`, `.../topics/topics-list.tsx`
- Theme tokens: `apps/web/src/app/globals.css`; UI kit: `apps/web/src/components/ui/{page-header,status-pill,empty-state,card,button,tabs}.tsx`
- Guardrails/meter: `packages/kb/src/topic-prompt.ts` (`DEFAULT_GUARDRAILS`, `TopicGuardrails`), `packages/kb/src/chunk.ts` (`meterTier`)

---

## File Structure

- Create `apps/web/src/lib/assistant.ts` — pure mappers (voice presets, size label, wizard→guardrails) + the `AssistantSummary` type. One responsibility: translate between plain-language UI and model fields.
- Create `apps/web/src/lib/assistant.test.ts` — unit tests for the mappers.
- Create `apps/web/src/lib/assistant-data.ts` — `listAssistants(workspaceId)` and `connectedInstances(workspaceId)` (server data helpers).
- Create `apps/web/src/lib/assistant-data.test.ts` — unit tests (mocked prisma).
- Create `apps/web/src/app/api/workspaces/[slug]/assistants/route.ts` — GET list.
- Create `apps/web/src/app/api/workspaces/[slug]/assistants/[id]/activate/route.ts` — POST turn-on (atomic), DELETE turn-off.
- Create `apps/web/src/app/[workspaceSlug]/assistants/page.tsx` + `assistants-list.tsx` — list page.
- Create `apps/web/src/app/[workspaceSlug]/assistants/new/page.tsx` + `wizard.tsx` — first-run wizard.
- Create `apps/web/src/app/[workspaceSlug]/assistants/[id]/page.tsx` + `assistant-home.tsx` — home screen.
- Modify `apps/web/src/components/shell/nav-config.tsx` — replace `topics` entry with `assistants`.
- Modify `apps/web/messages/en-GB.json` — add `nav.assistants`; keep `nav.topics` for back-compat redirect.
- Modify `apps/web/src/app/[workspaceSlug]/automation/topics/page.tsx` — redirect to `/assistants`.
- Modify `apps/ingest/src/automate.ts` — send `ChatTopic.greeting` as the welcome once per conversation (wire the dead field).
- Create `tests/e2e/ai-assistant.spec.ts` — end-to-end.

---

## Task 1: Plain-language mappers (`assistant.ts`)

**Files:**
- Create: `apps/web/src/lib/assistant.ts`
- Test: `apps/web/src/lib/assistant.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/assistant.test.ts
import { describe, it, expect } from "vitest";
import { VOICES, toneForVoice, voiceForTone, sizeLabel, buildGuardrails } from "./assistant";
import { DEFAULT_GUARDRAILS } from "@evo/kb";

describe("voice presets", () => {
  it("maps each voice to a tone string and back", () => {
    expect(VOICES.map((v) => v.id)).toEqual(["friendly", "professional", "playful"]);
    for (const v of VOICES) expect(voiceForTone(toneForVoice(v.id))).toBe(v.id);
  });
  it("defaults unknown tone to friendly", () => {
    expect(voiceForTone(null)).toBe("friendly");
    expect(voiceForTone("something custom")).toBe("friendly");
  });
});

describe("sizeLabel", () => {
  it("relabels token tiers as plain sizes", () => {
    expect(sizeLabel(1_000).label).toBe("Small");
    expect(sizeLabel(60_000).label).toBe("Medium");
    expect(sizeLabel(200_000).label).toBe("Large");
  });
  it("small is the reassuring/cheap tier", () => {
    expect(sizeLabel(1_000).tone).toBe("good");
  });
});

describe("buildGuardrails", () => {
  it("starts from DEFAULT_GUARDRAILS and applies the two plain toggles", () => {
    const g = buildGuardrails({ onlyFromKnowledge: true, handoff: true, handoffMessage: "Hold on 🙏" });
    expect(g.answerOnlyFromKnowledge).toBe(true);
    expect(g.handoff.enabled).toBe(true);
    expect(g.handoff.onUnsure).toBe(true);
    expect(g.fallbackMessage).toBe("Hold on 🙏");
    // untouched fields keep defaults
    expect(g.stayOnTopic).toBe(DEFAULT_GUARDRAILS.stayOnTopic);
  });
  it("off toggles disable cleanly", () => {
    const g = buildGuardrails({ onlyFromKnowledge: false, handoff: false, handoffMessage: "" });
    expect(g.answerOnlyFromKnowledge).toBe(false);
    expect(g.handoff.enabled).toBe(false);
    expect(g.handoff.onUnsure).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/web exec vitest run src/lib/assistant.test.ts`
Expected: FAIL — `Cannot find module './assistant'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/assistant.ts
import { DEFAULT_GUARDRAILS, meterTier, type TopicGuardrails } from "@evo/kb";

export type VoiceId = "friendly" | "professional" | "playful";

export const VOICES: { id: VoiceId; label: string; tone: string }[] = [
  { id: "friendly", label: "Friendly", tone: "warm, friendly and approachable" },
  { id: "professional", label: "Professional", tone: "professional, concise and polite" },
  { id: "playful", label: "Playful", tone: "playful, upbeat and casual" },
];

export function toneForVoice(id: VoiceId): string {
  return (VOICES.find((v) => v.id === id) ?? VOICES[0]).tone;
}

export function voiceForTone(tone: string | null | undefined): VoiceId {
  return (VOICES.find((v) => v.tone === tone)?.id) ?? "friendly";
}

// Relabel the token meter as a plain, non-technical size. Reuses @evo/kb meterTier
// (green/amber/red) so the thresholds stay consistent with the engine's cost model.
export function sizeLabel(tokens: number): { label: "Small" | "Medium" | "Large"; hint: string; tone: "good" | "warn" | "high" } {
  const tier = meterTier(tokens); // "green" | "amber" | "red"
  if (tier === "green") return { label: "Small", hint: "fast & low cost", tone: "good" };
  if (tier === "amber") return { label: "Medium", hint: "still fine — a bit slower", tone: "warn" };
  return { label: "Large", hint: "slower & pricier — consider trimming", tone: "high" };
}

export function buildGuardrails(opts: { onlyFromKnowledge: boolean; handoff: boolean; handoffMessage: string }): TopicGuardrails {
  const base = DEFAULT_GUARDRAILS;
  return {
    ...base,
    answerOnlyFromKnowledge: opts.onlyFromKnowledge,
    handoff: { ...base.handoff, enabled: opts.handoff, onUnsure: opts.handoff },
    fallbackMessage: opts.handoffMessage.trim() || base.fallbackMessage,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/web exec vitest run src/lib/assistant.test.ts`
Expected: PASS (7 tests). If `meterTier` thresholds differ, adjust the test's token values to match `packages/kb/src/chunk.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/assistant.ts apps/web/src/lib/assistant.test.ts
git commit -m "feat(assistant): plain-language voice/size/guardrail mappers"
```

---

## Task 2: Assistant data helpers (`assistant-data.ts`)

**Files:**
- Create: `apps/web/src/lib/assistant-data.ts`
- Test: `apps/web/src/lib/assistant-data.test.ts`

`AssistantSummary` derives an assistant's "live" status from the `Chatbot` rows referencing its topic.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/assistant-data.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@evo/db", () => ({
  tenantClient: () => ({ chatTopic: { findMany }, instance: { findMany: vi.fn() } }),
}));

const { toAssistantSummaries } = await import("./assistant-data");

beforeEach(() => vi.clearAllMocks());

describe("toAssistantSummaries", () => {
  it("marks a topic live when an enabled chatbot with AI references it", () => {
    const topics = [{
      id: "t1", name: "YLP", personaTone: "warm, friendly and approachable",
      _count: { snippets: 28 },
      chatbots: [{ enabled: true, fallbackProvider: "claude", instance: { label: "iPhone 11" } }],
    }];
    const [a] = toAssistantSummaries(topics as any);
    expect(a.status).toBe("live");
    expect(a.liveOn).toBe("iPhone 11");
    expect(a.knowledgeCount).toBe(28);
  });
  it("marks a topic draft when no enabled chatbot references it", () => {
    const topics = [{ id: "t2", name: "Draft", personaTone: null, _count: { snippets: 3 }, chatbots: [] }];
    const [a] = toAssistantSummaries(topics as any);
    expect(a.status).toBe("draft");
    expect(a.liveOn).toBeNull();
  });
  it("treats enabled-but-AI-off (fallbackProvider none) as NOT live", () => {
    const topics = [{ id: "t3", name: "X", personaTone: null, _count: { snippets: 1 },
      chatbots: [{ enabled: true, fallbackProvider: "none", instance: { label: "S21" } }] }];
    expect(toAssistantSummaries(topics as any)[0].status).toBe("draft");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/web exec vitest run src/lib/assistant-data.test.ts`
Expected: FAIL — `Cannot find module './assistant-data'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/assistant-data.ts
import { tenantClient } from "@evo/db";
import { voiceForTone, type VoiceId } from "./assistant";

export type AssistantSummary = {
  id: string;
  name: string;
  voice: VoiceId;
  knowledgeCount: number;
  status: "live" | "draft";
  liveOn: string | null;
};

type TopicRow = {
  id: string; name: string; personaTone: string | null;
  _count: { snippets: number };
  chatbots: { enabled: boolean; fallbackProvider: string; instance: { label: string } | null }[];
};

// A topic is "live" only when a chatbot is enabled AND its AI is on (fallbackProvider != none) —
// this mirrors the engine gate at apps/ingest/src/automate.ts:181 and is exactly the state the
// old UI let users miss.
export function toAssistantSummaries(topics: TopicRow[]): AssistantSummary[] {
  return topics.map((t) => {
    const liveBot = t.chatbots.find((c) => c.enabled && c.fallbackProvider !== "none");
    return {
      id: t.id,
      name: t.name,
      voice: voiceForTone(t.personaTone),
      knowledgeCount: t._count.snippets,
      status: liveBot ? "live" : "draft",
      liveOn: liveBot?.instance?.label ?? null,
    };
  });
}

export async function listAssistants(workspaceId: string): Promise<AssistantSummary[]> {
  const db = tenantClient(workspaceId);
  const topics = await db.chatTopic.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { snippets: true } },
      chatbots: { select: { enabled: true, fallbackProvider: true, instance: { select: { label: true } } } },
    },
  });
  return toAssistantSummaries(topics as unknown as TopicRow[]);
}

export async function connectedInstances(workspaceId: string): Promise<{ id: string; label: string }[]> {
  const db = tenantClient(workspaceId);
  const rows = await db.instance.findMany({
    where: { connectionState: "open" },
    select: { id: true, label: true },
    orderBy: { label: "asc" },
  });
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/web exec vitest run src/lib/assistant-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/assistant-data.ts apps/web/src/lib/assistant-data.test.ts
git commit -m "feat(assistant): derive live/draft status + list/instances data helpers"
```

---

## Task 3: Atomic turn-on/off API (`activate` route)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/assistants/[id]/activate/route.ts`
- Test: `apps/web/src/lib/activate-assistant.test.ts`
- Create: `apps/web/src/lib/activate-assistant.ts` (extracted so it's unit-testable without HTTP)

The core fix: **one** operation sets `enabled + topicId + fallbackProvider` together.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/activate-assistant.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const upsert = vi.fn(); const updateMany = vi.fn();
vi.mock("@evo/db", () => ({ tenantClient: () => ({ chatbot: { upsert, updateMany } }) }));
const { activateAssistant, deactivateAssistant } = await import("./activate-assistant");
beforeEach(() => vi.clearAllMocks());

describe("activateAssistant", () => {
  it("upserts the chatbot with enabled + topicId + AI on, in one call", async () => {
    await activateAssistant("ws1", "topic1", "inst1");
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ instanceId: "inst1" });
    expect(arg.create).toMatchObject({ instanceId: "inst1", topicId: "topic1", enabled: true, fallbackProvider: "claude" });
    expect(arg.update).toMatchObject({ topicId: "topic1", enabled: true, fallbackProvider: "claude" });
  });
});
describe("deactivateAssistant", () => {
  it("disables all chatbots for this topic without deleting them", async () => {
    await deactivateAssistant("ws1", "topic1");
    expect(updateMany).toHaveBeenCalledWith({ where: { topicId: "topic1" }, data: { enabled: false } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/web exec vitest run src/lib/activate-assistant.test.ts`
Expected: FAIL — `Cannot find module './activate-assistant'`.

- [ ] **Step 3: Write the implementation + route**

```ts
// apps/web/src/lib/activate-assistant.ts
import { tenantClient } from "@evo/db";

// "AI on" flag. The Chatbot enum is none|claude|openai; "claude" just means "AI enabled" —
// the real model is resolved from the workspace "chatbot" AI scope (resolveAiConfig), which is
// Ollama/Gemini/etc. This is the single atomic fix for the silent-failure trap.
const AI_ON = "claude" as const;

export async function activateAssistant(workspaceId: string, topicId: string, instanceId: string) {
  const db = tenantClient(workspaceId);
  return db.chatbot.upsert({
    where: { instanceId },
    create: { instanceId, topicId, enabled: true, fallbackProvider: AI_ON } as any,
    update: { topicId, enabled: true, fallbackProvider: AI_ON } as any,
  });
}

export async function deactivateAssistant(workspaceId: string, topicId: string) {
  const db = tenantClient(workspaceId);
  return db.chatbot.updateMany({ where: { topicId }, data: { enabled: false } });
}
```

```ts
// apps/web/src/app/api/workspaces/[slug]/assistants/[id]/activate/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { activateAssistant, deactivateAssistant } from "@/lib/activate-assistant";

const body = z.object({ instanceId: z.string() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    // Validate both belong to this workspace (tenantClient scopes the reads).
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const inst = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!inst) return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 404 });
    await activateAssistant(workspace.id, id, parsed.data.instanceId);
    return NextResponse.json({ ok: true });
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
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    await deactivateAssistant(workspace.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @evo/web exec vitest run src/lib/activate-assistant.test.ts && pnpm --filter @evo/web typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/activate-assistant.ts apps/web/src/lib/activate-assistant.test.ts "apps/web/src/app/api/workspaces/[slug]/assistants"
git commit -m "feat(assistant): atomic turn-on/off API (enabled+topic+AI in one action)"
```

---

## Task 4: Assistants list API (`GET /assistants`)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/assistants/route.ts`

- [ ] **Step 1: Write the implementation** (thin wrapper over Task 2; covered by the E2E test in Task 12, no separate unit test needed)

```ts
// apps/web/src/app/api/workspaces/[slug]/assistants/route.ts
import { NextResponse } from "next/server";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { listAssistants, connectedInstances } from "@/lib/assistant-data";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const [assistants, instances] = await Promise.all([
      listAssistants(workspace.id),
      connectedInstances(workspace.id),
    ]);
    return NextResponse.json({ assistants, instances });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @evo/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/assistants/route.ts"
git commit -m "feat(assistant): GET /assistants list + connected instances"
```

---

## Task 5: Assistants list page + nav change

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/assistants/page.tsx`, `.../assistants/assistants-list.tsx`
- Modify: `apps/web/src/components/shell/nav-config.tsx` (replace `topics` → `assistants`)
- Modify: `apps/web/messages/en-GB.json` (add `nav.assistants`)
- Modify: `apps/web/src/app/[workspaceSlug]/automation/topics/page.tsx` (redirect to `/assistants`)
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx` (add `assistants` label to the labels map, mirror the existing `topics` entry)

Follow the exact patterns in `topics/topics-list.tsx` (client component, fetch, `useRouter`) and `topics/page.tsx` (server page). **All colors via theme classes** (`bg-card`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, `text-success`) — never hardcoded hex. Use the `StatusPill` component for live/draft.

- [ ] **Step 1: Nav + i18n + redirect**

In `nav-config.tsx`, replace the `{ key: "topics", path: "/automation/topics", icon: Bot }` item with:
```tsx
{ key: "assistants", path: "/assistants", icon: Bot },
```
In `en-GB.json` nav block add `"assistants": "AI Assistants"` (keep `"topics"` key).
In `layout.tsx` labels map add `assistants: t("nav.assistants"),` next to the `topics` line.
Replace the body of `automation/topics/page.tsx` with a redirect:
```tsx
import { redirect } from "next/navigation";
export default async function TopicsRedirect({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/assistants`);
}
```

- [ ] **Step 2: List page (server)**

```tsx
// apps/web/src/app/[workspaceSlug]/assistants/page.tsx
import { requireMember } from "@/lib/tenancy";
import { listAssistants } from "@/lib/assistant-data";
import AssistantsList from "./assistants-list";

export default async function AssistantsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const assistants = await listAssistants(workspace.id);
  return <AssistantsList workspaceSlug={workspaceSlug} initial={assistants} />;
}
```

- [ ] **Step 3: List component (client)** — cards with status pill, knowledge count, inline On/Off, Edit/Try; a one-time migration banner; "+ New Assistant" → `/assistants/new`. Mirror `topics-list.tsx` structure. On/Off calls `POST`/`DELETE /assistants/{id}/activate` (for Off) — Off needs no instance; On from a draft routes the user to the home screen's "turn on" picker (a draft has no instance yet). Use theme classes only.

```tsx
// apps/web/src/app/[workspaceSlug]/assistants/assistants-list.tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AssistantSummary } from "@/lib/assistant-data";
import { StatusPill } from "@/components/ui/status-pill";
import { Bot } from "lucide-react";

export default function AssistantsList({ workspaceSlug, initial }: { workspaceSlug: string; initial: AssistantSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function turnOff(id: string) {
    setBusy(id);
    await fetch(`/api/workspaces/${workspaceSlug}/assistants/${id}/activate`, { method: "DELETE" });
    setBusy(null); router.refresh();
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Assistants</h1>
          <p className="text-sm text-muted-foreground">Give an assistant a brain and a phone number. It answers your WhatsApp automatically.</p>
        </div>
        <Link href={`/${workspaceSlug}/assistants/new`} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">+ New Assistant</Link>
      </div>
      {initial.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No assistants yet. Create one to auto-reply on WhatsApp.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary"><Bot className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="font-semibold">{a.name}</div>
                <StatusPill tone={a.status === "live" ? "success" : "muted"}>
                  {a.status === "live" ? `Live on ${a.liveOn}` : "Draft — not on a number yet"}
                </StatusPill>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{a.knowledgeCount} knowledge items · {a.voice}</p>
            <div className="mt-3 flex gap-2">
              <Link href={`/${workspaceSlug}/assistants/${a.id}`} className="flex-1 rounded-md border border-border py-2 text-center text-xs font-semibold">Edit</Link>
              {a.status === "live"
                ? <button disabled={busy === a.id} onClick={() => turnOff(a.id)} className="flex-1 rounded-md border border-border py-2 text-xs font-semibold">Turn off</button>
                : <Link href={`/${workspaceSlug}/assistants/${a.id}`} className="flex-1 rounded-md border border-border py-2 text-center text-xs font-semibold">Turn on…</Link>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```
> If `StatusPill`'s prop API differs, read `components/ui/status-pill.tsx` and adapt. If it has no `muted` tone, use the neutral/default tone.

- [ ] **Step 4: Verify build + nav renders**

Run: `pnpm --filter @evo/web typecheck && pnpm --filter @evo/web build`
Expected: clean build; no `MISSING_MESSAGE` for `nav.assistants`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants" apps/web/src/components/shell/nav-config.tsx apps/web/messages/en-GB.json "apps/web/src/app/[workspaceSlug]/automation/topics/page.tsx" "apps/web/src/app/[workspaceSlug]/layout.tsx"
git commit -m "feat(assistant): AI Assistants nav + list page; redirect old Topics route"
```

---

## Task 6: Wizard — shell + Step 1 (Personality)

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/assistants/new/page.tsx`, `.../new/wizard.tsx`

The wizard is a client component holding all step state; it creates the `ChatTopic` on finishing Step 1 (so later steps can attach knowledge to a real topic id) via `POST /topics` then `PUT /topics/{id}` for persona. Mirror payloads used in `topic-editor.tsx`.

- [ ] **Step 1: Server page**

```tsx
// apps/web/src/app/[workspaceSlug]/assistants/new/page.tsx
import { requireMember } from "@/lib/tenancy";
import { connectedInstances } from "@/lib/assistant-data";
import Wizard from "./wizard";

export default async function NewAssistant({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const instances = await connectedInstances(workspace.id);
  return <Wizard workspaceSlug={workspaceSlug} instances={instances} />;
}
```

- [ ] **Step 2: Wizard shell + Step 1** — a `step` state (1–4), a progress rail using theme classes, and Step 1 fields: name, voice pills (from `VOICES`), first-message. "Next" creates the topic:
```tsx
// key logic inside wizard.tsx
const res = await fetch(`/api/workspaces/${workspaceSlug}/topics`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name }),
});
const { topic } = await res.json();
setTopicId(topic.id);
await fetch(`/api/workspaces/${workspaceSlug}/topics/${topic.id}`, {
  method: "PUT", headers: { "content-type": "application/json" },
  body: JSON.stringify({ personaTone: toneForVoice(voice), greeting: firstMessage || null }),
});
```
> Read `topics/route.ts` (POST) + `topics/[id]/route.ts` (PUT) first to confirm the accepted fields; extend the PUT zod schema if `personaTone`/`greeting` aren't yet accepted.

Build the progress rail + Step 1 markup mirroring the approved mockup, using `bg-primary text-primary-foreground` for the active step/selected voice pill, `bg-secondary text-muted-foreground` for inactive.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @evo/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants/new"
git commit -m "feat(assistant): setup wizard shell + personality step"
```

---

## Task 7: Wizard — Step 2 (Knowledge)

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx`

- [ ] **Step 1:** Add Step 2 UI: three add-methods (Upload PDF/Word, Paste text, Add Q&A) posting to the existing `topics/{id}/knowledge` and `topics/{id}/knowledge/upload` endpoints (read `topic-editor.tsx` for the exact payloads). After each add, re-fetch `GET topics/{id}/knowledge` to update the list + total tokens, and render the plain size via `sizeLabel(totalTokens)`. Two pre-checked toggles (`onlyFromKnowledge`, `handoff`) + an editable handoff message, held in wizard state (persisted to the topic in Step 4 via `PUT /topics/{id}` with `guardrails: buildGuardrails(...)`).

- [ ] **Step 2: Verify** — `pnpm --filter @evo/web typecheck` → clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx"
git commit -m "feat(assistant): wizard knowledge step with plain size + safety toggles"
```

---

## Task 8: Wizard — Step 3 (Try it)

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx`

- [ ] **Step 1:** Add Step 3: a chat box that POSTs to `topics/{id}/test` (body `{ message }`) and renders `reply` (or the `fellBack`/`AI_ERROR` states) in WhatsApp-style bubbles using `bg-[hsl(var(--bubble-out))]` / `bg-[hsl(var(--bubble-in))]`. Show 2–3 suggested questions. **Before testing, save the guardrails** (PUT `/topics/{id}` with `buildGuardrails(...)`) so the test reflects the toggles.

- [ ] **Step 2: Verify** — `pnpm --filter @evo/web typecheck` → clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx"
git commit -m "feat(assistant): wizard try-it step (live test before go-live)"
```

---

## Task 9: Wizard — Step 4 (Go live, atomic turn-on)

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx`

- [ ] **Step 1:** Add Step 4: a picker of connected `instances` (passed as props) + a green "Turn on — start replying now" button that (a) PUTs the final persona/guardrails to the topic, then (b) POSTs `/assistants/{topicId}/activate { instanceId }`. On success, `router.push(/{slug}/assistants/{topicId})`. Provide a secondary "Save as draft" link that skips activation and goes to the home screen. If `instances` is empty, show "Connect a WhatsApp number first" linking to `/instances`.

- [ ] **Step 2: Verify** — `pnpm --filter @evo/web typecheck` → clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants/new/wizard.tsx"
git commit -m "feat(assistant): wizard go-live step — one-button atomic turn-on"
```

---

## Task 10: Assistant home screen

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/assistants/[id]/page.tsx`, `.../[id]/assistant-home.tsx`

- [ ] **Step 1: Server page** — load the topic (`GET topics/{id}` or via `tenantClient`), its knowledge, its live status (reuse `listAssistants` filtered to this id, or a focused query), and `connectedInstances`. Pass to the client component.

- [ ] **Step 2: Home component** — hero (name, avatar, live-dot + "Live on X"/"Draft", On/Off switch), Personality card (voice + first message, editable inline via `PUT /topics/{id}`), Knowledge card (list + "Add knowledge", reuse the same add handlers as the wizard — extract them into a shared `KnowledgeEditor` sub-component if they grow), inline "Try it" (same as Step 3), a collapsed `<details>` **Advanced** hosting the existing keyword-trigger editor (import/reuse `automation/chatbot/[id]/rule-editor.tsx` — it needs a `chatbotId`; for a draft with no chatbot yet, hide quick-replies until the assistant is turned on) + guardrail fine-tuning, and a "Use on another number →" action (POST `/assistants/{id}/activate` with a second instance). On/Off: On (draft) opens the instance picker; Off calls `DELETE /assistants/{id}/activate`. **Theme classes only.**

- [ ] **Step 3: Verify** — `pnpm --filter @evo/web typecheck && pnpm --filter @evo/web build` → clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/assistants/[id]"
git commit -m "feat(assistant): assistant home screen (edit/test/on-off/advanced/reuse)"
```

---

## Task 11: Wire `greeting` → welcome message (fix the dead field)

**Files:**
- Modify: `apps/ingest/src/automate.ts`
- Test: `apps/ingest/src/automate.test.ts` (add a case if the harness supports it; else verify via the existing engine tests)

The topic's `greeting` is currently stored but never sent. When a topic-bound chatbot has no `welcomeMessage` and the topic has a `greeting`, use the greeting as the first-contact welcome.

- [ ] **Step 1:** In the topic branch, where the welcome/first message is decided, fall back to `topic.greeting` when `chatbot.welcomeMessage` is empty. Read the surrounding welcome logic first; make the change minimal and covered by an assertion in `automate.test.ts` if a welcome test exists.

- [ ] **Step 2: Verify** — `pnpm --filter @evo/ingest test && pnpm --filter @evo/ingest typecheck` → pass/clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ingest/src/automate.ts
git commit -m "fix(chatbot): send topic greeting as the welcome when no welcomeMessage set"
```

---

## Task 12: End-to-end test

**Files:**
- Create: `tests/e2e/ai-assistant.spec.ts`

- [ ] **Step 1:** Mirror an existing spec (`tests/e2e/automation.spec.ts`) for auth/workspace setup. Cover: navigate to **AI Assistants** → **New Assistant** → fill personality → add a Q&A → **Try it** (asserts a reply or graceful fallback) → **Go live** on a connected instance → assert the assistant card shows **"Live on …"**. Then assert (via API or DB helper) the `Chatbot` row for that instance has `enabled=true`, `topicId` set, `fallbackProvider != "none"`. Toggle **Turn off** → card shows **Draft**.

- [ ] **Step 2: Run** — `pnpm --filter @evo/web exec playwright test tests/e2e/ai-assistant.spec.ts` (or the repo's e2e command). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ai-assistant.spec.ts
git commit -m "test(e2e): AI Assistant create → knowledge → test → go-live → off"
```

---

## Notes for the implementer

- **Theme compliance is a hard requirement.** Never write a hex color in these components. Use Tailwind theme classes (`bg-card`, `bg-primary`, `text-primary-foreground`, `text-muted-foreground`, `text-success`, `border-border`, `bg-secondary`) or `hsl(var(--token))`. The mockups in `.superpowers/brainstorm/` used literal hex only because they were standalone previews.
- **No jargon in any user-visible string.** See the plain-language table in the spec.
- **Reuse, don't duplicate.** Knowledge add/list, the test chat, and keyword rules already exist under `topics/[id]/*` and `automation/chatbot/[id]/rule-editor.tsx` — import/extract rather than rewrite.
- **Back-compat:** leave the old `topics` and `chatbots` APIs intact; the new UI orchestrates them.
- **Migration banner (Task 5):** show a one-time dismissible banner on the list page — "We turned your existing setup into Assistants — nothing lost. Live ones stay live; drafts are off until you switch them on." (theme classes: `bg-success/10 border-success/30`). Persist dismissal in `localStorage`.
- **Legacy keyword-only chatbots (no topic) — first-cut simplification:** `listAssistants` lists `ChatTopic`s only, so a `Chatbot` with keyword triggers but no `topicId` will **not** appear as an Assistant in v1. That's acceptable: those bots remain editable via their existing `automation/chatbot/[id]` screen (which we do **not** redirect). Surfacing them as "quick replies only" assistant cards is a follow-up, explicitly out of scope for this plan (YAGNI).
```
