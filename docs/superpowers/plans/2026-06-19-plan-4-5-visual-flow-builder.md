# Plan 4.5 — Visual Flow Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer a node-based visual flow builder (React Flow) on top of the existing keyword chatbot so non-technical users can compose multi-step conversations.

**Architecture:** A `Flow` is a directed graph (nodes + edges) bound to a workspace. A flow is triggered by a keyword (same trigger surface as the current chatbot). When triggered, an in-memory step machine in `apps/ingest` advances a `FlowSession` row per contact through nodes. Node types: `send` (static text), `ask` (send + collect next reply into a variable), `wait` (delay), `branch` (condition on a variable), `ai-reply` (delegate to `@evo/ai`), `end`. Flow execution coexists with the keyword chatbot: a contact in an active session bypasses keyword matching until the session ends or times out. The editor is a `[workspaceSlug]/automation/flows/[id]` page rendering React Flow with a node palette, drag-to-connect edges, and JSON I/O.

**Tech Stack:** React Flow (`reactflow`), Prisma, BullMQ (for `wait` nodes), existing `@evo/ai`, `@evo/send`, next-intl.

---

## File Structure

**Schema:** `packages/db/prisma/schema.prisma` — three models (`Flow`, `FlowSession`, no edges/nodes models — graph stored as JSON columns on `Flow` to avoid join-heavy reads).

**Tenancy:** add `Flow` and `FlowSession` to `TENANTED_MODELS` in `packages/db/src/tenant.ts`.

**Engine (server-only, no UI deps):**
- `packages/flow-engine/src/types.ts` — node/edge types, session state shape.
- `packages/flow-engine/src/runner.ts` — `advanceSession(session, input?)` pure function returning `{ outbox: string[]; nextNodeId: string|null; waitUntil?: Date }`.
- `packages/flow-engine/src/runner.test.ts` — vitest cases for each node type.

**Ingest wiring:**
- `apps/ingest/src/flows.ts` — `tryEnterFlow(workspaceId, contactId, text)` + `advance(workspaceId, contactId, text)`; called from `apps/ingest/src/automate.ts` BEFORE the keyword fallthrough.

**Worker:**
- `apps/worker/src/index.ts` — add `flow-wait` queue + processor that re-enqueues `advance` after the wait timer fires.

**API:**
- `apps/web/src/app/api/workspaces/[slug]/flows/route.ts` — list / create.
- `apps/web/src/app/api/workspaces/[slug]/flows/[id]/route.ts` — get / put (whole graph) / delete.
- `apps/web/src/app/api/workspaces/[slug]/flows/[id]/publish/route.ts` — POST flips `published=true` and validates graph.

**UI:**
- `apps/web/src/app/[workspaceSlug]/automation/flows/page.tsx` — list of flows.
- `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/page.tsx` — server: load flow.
- `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/editor.tsx` — client: React Flow canvas.
- `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/node-palette.tsx` — drag-source for new nodes.
- `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/node-inspector.tsx` — right-pane form for selected node.

**i18n:** add `flows.*` namespace to `apps/web/messages/en-GB.json`.

---

## Task 1: Schema + tenancy

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`
- Generate migration: `packages/db/prisma/migrations/<ts>_flows/`

- [ ] **Step 1: Add models**

In `schema.prisma`, append after the automation block:

```prisma
model Flow {
  id          String   @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  name        String
  description String?
  triggerKeyword String?
  graph       Json     // { nodes: FlowNode[], edges: FlowEdge[] }
  published   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  sessions    FlowSession[]
  @@index([workspaceId, published])
  @@index([workspaceId, triggerKeyword])
}

model FlowSession {
  id          String   @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  flowId      String
  flow        Flow @relation(fields: [flowId], references: [id], onDelete: Cascade)
  contactId   String
  contact     Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  instanceId  String
  currentNodeId String
  variables   Json     @default("{}")
  state       FlowSessionState @default(active)
  waitUntil   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([workspaceId, contactId, flowId])
  @@index([state, waitUntil])
}

enum FlowSessionState {
  active
  waiting
  completed
  cancelled
}
```

Add the back-relations on `Workspace` and `Contact`.

- [ ] **Step 2: Add to TENANTED_MODELS**

`packages/db/src/tenant.ts`: append `"Flow"`, `"FlowSession"` to the set.

- [ ] **Step 3: Generate + apply migration**

```bash
pnpm --filter @evo/db prisma:migrate --name flows
```

Expected: migration applies cleanly to `evolution_manager` dev DB.

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "feat(db): Flow + FlowSession schema for visual flow builder"
```

---

## Task 2: `@evo/flow-engine` package (TDD)

**Files:**
- Create: `packages/flow-engine/package.json`, `tsconfig.json`, `src/types.ts`, `src/runner.ts`, `src/runner.test.ts`

- [ ] **Step 1: Bootstrap package**

`package.json`:

```json
{
  "name": "@evo/flow-engine",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@evo/ai": "workspace:*" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "5.7.2", "@types/node": "^22.0.0" }
}
```

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src/**/*"] }`.

`src/index.ts`: re-export from runner + types.

- [ ] **Step 2: Define types — `src/types.ts`**

```typescript
export type NodeType = "send" | "ask" | "wait" | "branch" | "ai-reply" | "end";

export interface BaseNode { id: string; type: NodeType; }

export interface SendNode extends BaseNode { type: "send"; text: string; }
export interface AskNode extends BaseNode { type: "ask"; prompt: string; variable: string; }
export interface WaitNode extends BaseNode { type: "wait"; seconds: number; }
export interface BranchNode extends BaseNode { type: "branch"; variable: string; equals: string; }
export interface AiReplyNode extends BaseNode { type: "ai-reply"; systemPrompt: string; model: string; }
export interface EndNode extends BaseNode { type: "end"; }

export type FlowNode = SendNode | AskNode | WaitNode | BranchNode | AiReplyNode | EndNode;

export interface FlowEdge { id: string; from: string; to: string; label?: string; }

export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; entry: string; }

export interface FlowSessionState {
  currentNodeId: string;
  variables: Record<string, string>;
}

export interface AdvanceInput {
  graph: FlowGraph;
  session: FlowSessionState;
  userText?: string;
  ai?: (systemPrompt: string, model: string, recentText: string) => Promise<string>;
}

export interface AdvanceResult {
  outbox: string[];           // texts to send out
  nextNodeId: string | null;  // null = done
  state: "active" | "waiting" | "completed";
  waitSeconds?: number;       // when state === "waiting"
  variables: Record<string, string>;
}
```

- [ ] **Step 3: Write failing test — `src/runner.test.ts`**

Cover one case per node type plus a multi-hop graph.

```typescript
import { describe, it, expect } from "vitest";
import { advanceSession } from "./runner";
import type { FlowGraph, FlowSessionState } from "./types";

const baseSession: FlowSessionState = { currentNodeId: "", variables: {} };

describe("advanceSession", () => {
  it("send node emits text and follows the only edge", async () => {
    const graph: FlowGraph = {
      entry: "a",
      nodes: [{ id: "a", type: "send", text: "hello" }, { id: "b", type: "end" }],
      edges: [{ id: "e1", from: "a", to: "b" }],
    };
    const r = await advanceSession({ graph, session: { ...baseSession, currentNodeId: "a" } });
    expect(r.outbox).toEqual(["hello"]);
    expect(r.state).toBe("completed");
  });

  it("ask node emits prompt then waits for input", async () => {
    const graph: FlowGraph = {
      entry: "a",
      nodes: [{ id: "a", type: "ask", prompt: "Name?", variable: "name" }, { id: "b", type: "end" }],
      edges: [{ id: "e1", from: "a", to: "b" }],
    };
    const r1 = await advanceSession({ graph, session: { ...baseSession, currentNodeId: "a" } });
    expect(r1.outbox).toEqual(["Name?"]);
    expect(r1.state).toBe("active");
    expect(r1.nextNodeId).toBe("a"); // stays on ask until input arrives

    const r2 = await advanceSession({ graph, session: { currentNodeId: "a", variables: {} }, userText: "Alice" });
    expect(r2.variables.name).toBe("Alice");
    expect(r2.state).toBe("completed");
  });

  it("wait node returns waiting + seconds", async () => {
    const graph: FlowGraph = {
      entry: "a",
      nodes: [{ id: "a", type: "wait", seconds: 60 }, { id: "b", type: "end" }],
      edges: [{ id: "e1", from: "a", to: "b" }],
    };
    const r = await advanceSession({ graph, session: { ...baseSession, currentNodeId: "a" } });
    expect(r.state).toBe("waiting");
    expect(r.waitSeconds).toBe(60);
  });

  it("branch node takes labelled edge when variable matches", async () => {
    const graph: FlowGraph = {
      entry: "br",
      nodes: [
        { id: "br", type: "branch", variable: "answer", equals: "yes" },
        { id: "y", type: "send", text: "great" },
        { id: "n", type: "send", text: "ok" },
        { id: "end", type: "end" },
      ],
      edges: [
        { id: "e1", from: "br", to: "y", label: "match" },
        { id: "e2", from: "br", to: "n", label: "nomatch" },
        { id: "e3", from: "y", to: "end" },
        { id: "e4", from: "n", to: "end" },
      ],
    };
    const r = await advanceSession({ graph, session: { currentNodeId: "br", variables: { answer: "yes" } } });
    expect(r.outbox).toEqual(["great"]);
  });

  it("ai-reply node calls the ai callback", async () => {
    const graph: FlowGraph = {
      entry: "a",
      nodes: [{ id: "a", type: "ai-reply", systemPrompt: "S", model: "M" }, { id: "b", type: "end" }],
      edges: [{ id: "e1", from: "a", to: "b" }],
    };
    const r = await advanceSession({
      graph,
      session: { currentNodeId: "a", variables: {} },
      userText: "hi",
      ai: async () => "ai-says-hi",
    });
    expect(r.outbox).toEqual(["ai-says-hi"]);
  });
});
```

- [ ] **Step 4: Run, verify FAIL**

```bash
pnpm --filter @evo/flow-engine test
```

Expected: FAIL — runner.ts not implemented.

- [ ] **Step 5: Implement `src/runner.ts`**

```typescript
import type { AdvanceInput, AdvanceResult, FlowGraph, FlowNode, FlowSessionState } from "./types";

function findNode(graph: FlowGraph, id: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function nextEdge(graph: FlowGraph, fromId: string, label?: string) {
  if (label) return graph.edges.find((e) => e.from === fromId && e.label === label);
  return graph.edges.find((e) => e.from === fromId);
}

export async function advanceSession(input: AdvanceInput): Promise<AdvanceResult> {
  const { graph } = input;
  let session: FlowSessionState = { ...input.session, variables: { ...input.session.variables } };
  const outbox: string[] = [];
  // Bounded loop to prevent runaway flows
  for (let i = 0; i < 32; i++) {
    const node = findNode(graph, session.currentNodeId);
    if (!node) return { outbox, nextNodeId: null, state: "completed", variables: session.variables };

    if (node.type === "send") {
      outbox.push(node.text);
      const e = nextEdge(graph, node.id);
      if (!e) return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
      session.currentNodeId = e.to;
      continue;
    }

    if (node.type === "ask") {
      if (input.userText !== undefined && i === 0) {
        session.variables[node.variable] = input.userText;
        const e = nextEdge(graph, node.id);
        if (!e) return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
        session.currentNodeId = e.to;
        continue;
      }
      outbox.push(node.prompt);
      return { outbox, nextNodeId: node.id, state: "active", variables: session.variables };
    }

    if (node.type === "wait") {
      const e = nextEdge(graph, node.id);
      return {
        outbox,
        nextNodeId: e?.to ?? null,
        state: "waiting",
        waitSeconds: node.seconds,
        variables: session.variables,
      };
    }

    if (node.type === "branch") {
      const v = session.variables[node.variable];
      const label = v === node.equals ? "match" : "nomatch";
      const e = nextEdge(graph, node.id, label);
      if (!e) return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
      session.currentNodeId = e.to;
      continue;
    }

    if (node.type === "ai-reply") {
      if (!input.ai) throw new Error("ai callback not provided");
      const reply = await input.ai(node.systemPrompt, node.model, input.userText ?? "");
      outbox.push(reply);
      const e = nextEdge(graph, node.id);
      if (!e) return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
      session.currentNodeId = e.to;
      continue;
    }

    if (node.type === "end") {
      return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
    }
  }
  return { outbox, nextNodeId: null, state: "completed", variables: session.variables };
}
```

- [ ] **Step 6: Run, verify PASS**

```bash
pnpm --filter @evo/flow-engine test
```

Expected: 5/5 PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/flow-engine
git commit -m "feat(flow-engine): node-based flow runner with 5 node types"
```

---

## Task 3: Flow CRUD API + publish

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/flows/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/flows/[id]/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/flows/[id]/publish/route.ts`

- [ ] **Step 1: list + create**

```typescript
// route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const createSchema = z.object({ name: z.string().min(1), triggerKeyword: z.string().optional() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const flows = await db.flow.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, triggerKeyword: true, published: true, updatedAt: true },
    });
    return NextResponse.json({ flows });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const entryId = "entry";
    const flow = await db.flow.create({
      data: {
        name: parsed.data.name,
        triggerKeyword: parsed.data.triggerKeyword,
        graph: { entry: entryId, nodes: [{ id: entryId, type: "end" }], edges: [] } as any,
      } as any,
      select: { id: true },
    });
    return NextResponse.json({ id: flow.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: get / put / delete**

```typescript
// [id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const putSchema = z.object({
  name: z.string().min(1).optional(),
  triggerKeyword: z.string().nullish(),
  graph: z.object({
    entry: z.string(),
    nodes: z.array(z.object({ id: z.string(), type: z.enum(["send","ask","wait","branch","ai-reply","end"]) }).passthrough()),
    edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string().optional() })),
  }).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const flow = await db.flow.findUnique({ where: { id } });
    if (!flow) throw new NotFoundError("flow not found");
    return NextResponse.json({ flow });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.flow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("flow not found");
    await db.flow.update({ where: { id }, data: parsed.data as any });
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
    const existing = await db.flow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("flow not found");
    await db.flow.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: publish endpoint**

```typescript
// publish/route.ts
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

function validateGraph(graph: any): string | null {
  if (!graph?.entry || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return "MALFORMED";
  const ids = new Set(graph.nodes.map((n: any) => n.id));
  if (!ids.has(graph.entry)) return "ENTRY_NOT_IN_NODES";
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return "DANGLING_EDGE";
  }
  // At least one end node reachable check is left to runtime.
  return null;
}

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const flow = await db.flow.findUnique({ where: { id } });
    if (!flow) throw new NotFoundError("flow not found");
    const err = validateGraph(flow.graph);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    if (!flow.triggerKeyword) return NextResponse.json({ error: "TRIGGER_REQUIRED" }, { status: 400 });
    await db.flow.update({ where: { id }, data: { published: true } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/flows"
git commit -m "feat(web): flows CRUD + publish endpoint"
```

---

## Task 4: Ingest wiring (tryEnterFlow + advance)

**Files:**
- Create: `apps/ingest/src/flows.ts`
- Modify: `apps/ingest/src/automate.ts`

- [ ] **Step 1: flows.ts**

```typescript
import { prisma } from "@evo/db";
import { advanceSession, type FlowGraph } from "@evo/flow-engine";
import { sendViaInstance } from "@evo/send";
import { claudeReply } from "@evo/ai";
import { decrypt } from "@evo/crypto";

async function resolveAiKey(workspaceId: string): Promise<string | undefined> {
  const row = await prisma.workspaceAiKey.findUnique({ where: { workspaceId } });
  if (row?.provider === "claude") {
    try { return await decrypt(row.encryptedKey); } catch { /* fall through */ }
  }
  return process.env.ANTHROPIC_API_KEY ?? undefined;
}

export async function tryEnterFlow(workspaceId: string, instanceId: string, contactId: string, contactJid: string, text: string): Promise<boolean> {
  const existing = await prisma.flowSession.findFirst({
    where: { workspaceId, contactId, state: { in: ["active", "waiting"] } },
  });
  if (existing) {
    await runStep(workspaceId, instanceId, contactJid, existing.id, text);
    return true;
  }
  const flow = await prisma.flow.findFirst({
    where: { workspaceId, published: true, triggerKeyword: text.trim().toLowerCase() },
  });
  if (!flow) return false;
  const graph = flow.graph as unknown as FlowGraph;
  const session = await prisma.flowSession.create({
    data: { workspaceId, flowId: flow.id, contactId, instanceId, currentNodeId: graph.entry, variables: {} },
  });
  await runStep(workspaceId, instanceId, contactJid, session.id, undefined);
  return true;
}

async function runStep(workspaceId: string, instanceId: string, jid: string, sessionId: string, userText: string | undefined) {
  const session = await prisma.flowSession.findUnique({ where: { id: sessionId }, include: { flow: true } });
  if (!session) return;
  const graph = session.flow.graph as unknown as FlowGraph;
  const apiKey = await resolveAiKey(workspaceId);
  const result = await advanceSession({
    graph,
    session: { currentNodeId: session.currentNodeId, variables: session.variables as Record<string, string> },
    userText,
    ai: async (system, model, recent) =>
      claudeReply({ model, systemPrompt: system, messages: [{ role: "user", content: recent }], apiKey }),
  });
  for (const text of result.outbox) {
    await sendViaInstance({ workspaceId, instanceId, to: jid, text });
  }
  await prisma.flowSession.update({
    where: { id: sessionId },
    data: {
      currentNodeId: result.nextNodeId ?? session.currentNodeId,
      variables: result.variables,
      state: result.state === "completed" ? "completed" : result.state === "waiting" ? "waiting" : "active",
      waitUntil: result.state === "waiting" && result.waitSeconds ? new Date(Date.now() + result.waitSeconds * 1000) : null,
    },
  });
  if (result.state === "waiting" && result.waitSeconds) {
    const { flowQueue } = await import("@evo/queue");
    await flowQueue.add("advance", { sessionId, instanceId, workspaceId, jid }, { delay: result.waitSeconds * 1000 });
  }
}

export async function advanceWaitingSession(workspaceId: string, instanceId: string, jid: string, sessionId: string) {
  await runStep(workspaceId, instanceId, jid, sessionId, undefined);
}
```

- [ ] **Step 2: Add `flowQueue` to `@evo/queue`**

Modify `packages/queue/src/index.ts` to register the queue (follow existing pattern for other queues; one line for queue + processor name).

- [ ] **Step 3: Wire into automate.ts**

Read `apps/ingest/src/automate.ts`. At the top of the function, after resolving the contact and BEFORE keyword/AI handling, add:

```typescript
import { tryEnterFlow } from "./flows";
// ...
const handled = await tryEnterFlow(input.workspaceId, input.instanceId, contact.id, input.from, input.text);
if (handled) return;
```

- [ ] **Step 4: Worker processor for flow-wait**

In `apps/worker/src/index.ts`, register a processor for the flow queue:

```typescript
const flowWorker = new Worker("flow", async (job) => {
  if (job.name === "advance") {
    const { advanceWaitingSession } = await import("@evo/ingest-flows");
    // OR: copy advanceWaitingSession into a shared place reachable by worker.
    await advanceWaitingSession(job.data.workspaceId, job.data.instanceId, job.data.jid, job.data.sessionId);
  }
}, { connection });
```

(If keeping it inside `apps/ingest` causes circular deps, extract `flows.ts` into a `packages/ingest-flows/` package — the engineer should decide based on what compiles.)

- [ ] **Step 5: typecheck + tests**

```bash
pnpm --filter @evo/ingest typecheck
pnpm --filter @evo/worker typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/ingest apps/worker packages/queue
git commit -m "feat(ingest,worker): flow session runner with wait timer support"
```

---

## Task 5: React Flow editor UI

**Files:**
- Modify: `apps/web/package.json` — add `reactflow` dependency.
- Create: `apps/web/src/app/[workspaceSlug]/automation/flows/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/editor.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/automation/flows/[id]/node-inspector.tsx`

- [ ] **Step 1: Install reactflow**

```bash
pnpm --filter @evo/web add reactflow
```

- [ ] **Step 2: List page**

```tsx
import Link from "next/link";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { getTranslations } from "next-intl/server";

export default async function FlowsListPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const flows = await db.flow.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true, triggerKeyword: true, published: true, updatedAt: true } });
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">{t("flows.title")}</h1>
        <Link href={`/${workspaceSlug}/automation/flows/new`} className="bg-black text-white rounded p-2 px-4 text-sm">{t("flows.new")}</Link>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-gray-50">
          <tr><th className="text-left p-2">Name</th><th className="text-left p-2">Trigger</th><th className="text-left p-2">Status</th></tr>
        </thead>
        <tbody>
          {flows.map((f) => (
            <tr key={f.id} className="border-t">
              <td className="p-2"><Link href={`/${workspaceSlug}/automation/flows/${f.id}`} className="underline">{f.name}</Link></td>
              <td className="p-2"><code className="text-xs">{f.triggerKeyword ?? "—"}</code></td>
              <td className="p-2">{f.published ? t("flows.published") : t("flows.draft")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(Add a quick `flows/new` route that POSTs and redirects; or use the editor on `[id]=new` and POST-then-replace-url on first save. Engineer chooses.)

- [ ] **Step 3: Editor server page**

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import Editor from "./editor";

export default async function FlowEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Agent");
  const db = tenantClient(workspace.id);
  const flow = await db.flow.findUnique({ where: { id } });
  if (!flow) return <div className="p-8">Not found</div>;
  return <Editor workspaceSlug={workspaceSlug} flow={{ id: flow.id, name: flow.name, triggerKeyword: flow.triggerKeyword, published: flow.published, graph: flow.graph as any }} />;
}
```

- [ ] **Step 4: Editor client component**

```tsx
"use client";
import { useCallback, useState } from "react";
import ReactFlow, { Background, Controls, addEdge, useNodesState, useEdgesState, type Connection, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import NodeInspector from "./node-inspector";

type FlowNodeData = { type: string; label: string; config: Record<string, any> };

const NODE_TEMPLATES: { type: string; label: string; defaults: Record<string, any> }[] = [
  { type: "send", label: "Send", defaults: { text: "Hello" } },
  { type: "ask", label: "Ask", defaults: { prompt: "What is your name?", variable: "name" } },
  { type: "wait", label: "Wait", defaults: { seconds: 60 } },
  { type: "branch", label: "Branch", defaults: { variable: "answer", equals: "yes" } },
  { type: "ai-reply", label: "AI Reply", defaults: { systemPrompt: "You are helpful.", model: "claude-haiku-4-5-20251001" } },
  { type: "end", label: "End", defaults: {} },
];

export default function Editor({ workspaceSlug, flow }: { workspaceSlug: string; flow: { id: string; name: string; triggerKeyword: string | null; published: boolean; graph: any } }) {
  const initialNodes: Node<FlowNodeData>[] = flow.graph.nodes.map((n: any, i: number) => ({
    id: n.id,
    position: { x: 100 + (i % 4) * 220, y: 100 + Math.floor(i / 4) * 140 },
    data: { type: n.type, label: n.type, config: { ...n, id: undefined, type: undefined } },
    type: "default",
  }));
  const initialEdges: Edge[] = flow.graph.edges.map((e: any) => ({ id: e.id, source: e.from, target: e.to, label: e.label }));
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(flow.name);
  const [trigger, setTrigger] = useState(flow.triggerKeyword ?? "");
  const [busy, setBusy] = useState(false);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, id: `e${Date.now()}` }, es)), [setEdges]);

  function addNode(tpl: typeof NODE_TEMPLATES[number]) {
    const id = `n${Date.now()}`;
    setNodes((ns) => [...ns, { id, position: { x: 200, y: 200 }, data: { type: tpl.type, label: tpl.label, config: { ...tpl.defaults } }, type: "default" }]);
  }

  function buildGraph() {
    const graphNodes = nodes.map((n) => ({ id: n.id, type: n.data.type, ...n.data.config }));
    const graphEdges = edges.map((e) => ({ id: e.id, from: e.source, to: e.target, label: (e.label as string) || undefined }));
    const entry = nodes[0]?.id ?? "entry";
    return { entry, nodes: graphNodes, edges: graphEdges };
  }

  async function save() {
    setBusy(true);
    await fetch(`/api/workspaces/${workspaceSlug}/flows/${flow.id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, triggerKeyword: trigger || null, graph: buildGraph() }),
    });
    setBusy(false);
  }

  async function publish() {
    await save();
    const res = await fetch(`/api/workspaces/${workspaceSlug}/flows/${flow.id}/publish`, { method: "POST" });
    if (!res.ok) alert((await res.json()).error);
  }

  const selected = nodes.find((n) => n.id === selectedId);

  return (
    <div className="h-screen flex flex-col">
      <div className="border-b p-3 flex gap-3 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} className="border rounded p-1 px-2" />
        <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="trigger keyword" className="border rounded p-1 px-2" />
        <button onClick={save} disabled={busy} className="border rounded p-1 px-3 text-sm">Save</button>
        <button onClick={publish} disabled={busy} className="bg-black text-white rounded p-1 px-3 text-sm">Publish</button>
        <div className="ml-auto flex gap-1">
          {NODE_TEMPLATES.map((t) => (
            <button key={t.type} onClick={() => addNode(t)} className="border rounded p-1 px-2 text-xs">+ {t.label}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        {selected && (
          <NodeInspector
            key={selected.id}
            node={selected}
            onChange={(config) => setNodes((ns) => ns.map((n) => n.id === selected.id ? { ...n, data: { ...n.data, config } } : n))}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Node inspector**

```tsx
"use client";
import { type Node } from "reactflow";

type NodeData = { type: string; label: string; config: Record<string, any> };

export default function NodeInspector({ node, onChange }: { node: Node<NodeData>; onChange: (config: Record<string, any>) => void }) {
  const t = node.data.type;
  const c = node.data.config;
  function set(key: string, value: any) { onChange({ ...c, [key]: value }); }
  return (
    <div className="w-80 border-l p-4 space-y-3">
      <h2 className="font-semibold capitalize">{t}</h2>
      {t === "send" && <label className="block"><span className="text-sm">Text</span><textarea className="w-full border rounded p-2 mt-1" value={c.text ?? ""} onChange={(e) => set("text", e.target.value)} /></label>}
      {t === "ask" && <>
        <label className="block"><span className="text-sm">Prompt</span><textarea className="w-full border rounded p-2 mt-1" value={c.prompt ?? ""} onChange={(e) => set("prompt", e.target.value)} /></label>
        <label className="block"><span className="text-sm">Variable name</span><input className="w-full border rounded p-2 mt-1" value={c.variable ?? ""} onChange={(e) => set("variable", e.target.value)} /></label>
      </>}
      {t === "wait" && <label className="block"><span className="text-sm">Seconds</span><input type="number" className="w-full border rounded p-2 mt-1" value={c.seconds ?? 60} onChange={(e) => set("seconds", Number(e.target.value))} /></label>}
      {t === "branch" && <>
        <label className="block"><span className="text-sm">Variable</span><input className="w-full border rounded p-2 mt-1" value={c.variable ?? ""} onChange={(e) => set("variable", e.target.value)} /></label>
        <label className="block"><span className="text-sm">Equals</span><input className="w-full border rounded p-2 mt-1" value={c.equals ?? ""} onChange={(e) => set("equals", e.target.value)} /></label>
        <p className="text-xs text-gray-600">Edge labels: <code>match</code> and <code>nomatch</code>.</p>
      </>}
      {t === "ai-reply" && <>
        <label className="block"><span className="text-sm">System prompt</span><textarea className="w-full border rounded p-2 mt-1" value={c.systemPrompt ?? ""} onChange={(e) => set("systemPrompt", e.target.value)} /></label>
        <label className="block"><span className="text-sm">Model</span><input className="w-full border rounded p-2 mt-1" value={c.model ?? ""} onChange={(e) => set("model", e.target.value)} /></label>
      </>}
    </div>
  );
}
```

- [ ] **Step 6: i18n**

Add to `apps/web/messages/en-GB.json`:

```json
  "flows": {
    "title": "Flows",
    "new": "New flow",
    "published": "Published",
    "draft": "Draft"
  },
```

- [ ] **Step 7: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add apps/web/package.json pnpm-lock.yaml "apps/web/src/app/[workspaceSlug]/automation/flows" apps/web/messages/en-GB.json
git commit -m "feat(web): visual flow builder (React Flow) for chatbot flows"
```

---

## Task 6: e2e — send keyword, expect flow run

**Files:**
- Create: `apps/web/tests/e2e/flow.spec.ts`

- [ ] **Step 1: Test**

Use the existing stub Evolution server pattern (see other e2e specs). Create a flow with one `send` node, publish it, simulate an inbound webhook with the trigger keyword, assert the worker enqueued one outbound message via the stub.

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @evo/web e2e -- flow.spec.ts
git add apps/web/tests/e2e/flow.spec.ts
git commit -m "test(web): e2e for flow trigger and execution"
```

---

## Task 7: Final review

Dispatch a code-reviewer subagent over the whole branch slice for this plan.

Verify:
- Tenancy: `Flow` and `FlowSession` in `TENANTED_MODELS`.
- `flow-engine` tests all pass (5/5).
- Flow execution gates AI fallback: an active session bypasses keyword/AI in `automate.ts`.
- `wait` nodes correctly enqueue + delay; no busy-wait in the runner.
- Publish endpoint enforces graph validity.
- React Flow CSS imported.
- No secrets in graph JSON (it's a workspace-level value, no special handling needed).
