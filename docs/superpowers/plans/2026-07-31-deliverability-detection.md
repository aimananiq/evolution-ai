# Deliverability Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detect numbers that accept sends but don't deliver — both **slow-bans** (canary probe) and **dead sessions** (send-failure rate) — flag them in Number Health, and auto-exclude them from the rotator + warmer.

**Architecture:** A new `DeliverabilityProbe` model + four `Instance` health fields. A worker `canary-tick` sends periodic marked probes between a workspace's own numbers; ingest recognises the probe on receipt and marks it delivered; unreceived probes become misses that flag `delivery_failing`. Separately, `sendViaInstance` counts hard send errors (`Evolution 500`/"Connection Closed") into `sendFailStreak`, which the tick turns into `send_failing`. Both statuses exclude a number from `runGroupTick` (rotator) and warmer participant selection, and show as a badge in Number Health. Spec: `docs/superpowers/specs/2026-07-29-deliverability-canary-design.md`.

**Tech Stack:** Prisma/Postgres, BullMQ worker, Next.js API + React, Vitest. Constants: `CANARY_INTERVAL=4h`, `CANARY_TIMEOUT=10min`, miss-flag threshold `2`, send-fail threshold `5`.

**Conventions:** migrations in `packages/db/prisma/migrations/<ts>_<name>/migration.sql` (additive/nullable), run `pnpm --filter @evo/db exec prisma generate` after schema edits (set `DATABASE_URL=postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public` locally). Worker/ingest tests are DB-backed against `evolution_manager_test`. Commit after each task.

---

## File Structure
- Modify `packages/db/prisma/schema.prisma` + new migration `20260731100000_deliverability`; `packages/db/src/tenant.ts` (+`DeliverabilityProbe`).
- Modify `packages/send/src/index.ts` — count send failures.
- Create `apps/worker/src/canary-tick.ts`; modify `apps/worker/src/index.ts` (register tick); test `apps/worker/src/canary-tick.test.ts`.
- Modify `apps/ingest/src/inbound.ts` (probe receipt) + `apps/ingest/src/persist.ts` (reset on reconnect); test.
- Modify `apps/worker/src/broadcast-scheduler.ts` (rotator eligibility) + `apps/worker/src/warmer-tick.ts` (warmer eligibility).
- Modify Number Health UI + new route `api/workspaces/[slug]/instances/[id]/test-delivery`.

---

## Task 1: Schema — probe model + instance health fields

**Files:** `packages/db/prisma/schema.prisma`, new migration, `packages/db/src/tenant.ts`

- [ ] **Step 1: Add the model** (after the `Instance`/health models):
```prisma
model DeliverabilityProbe {
  id                String    @id @default(cuid())
  workspaceId       String
  instanceId        String    // sender under test
  controlInstanceId String    // receiver (another number in the workspace)
  token             String    @unique
  status            String    @default("pending") // pending | delivered | missed
  sentAt            DateTime  @default(now())
  receivedAt        DateTime?
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, instanceId, sentAt])
  @@index([status])
}
```
Add back-relation on `Workspace`: `deliverabilityProbes DeliverabilityProbe[]`.

- [ ] **Step 2: Add `Instance` fields** (next to `connectionState`):
```prisma
  deliveryStatus     String    @default("unknown") // unknown | ok | delivery_failing | send_failing
  deliveryCheckedAt  DateTime?
  deliveryMissStreak Int       @default(0)
  sendFailStreak     Int       @default(0)
```

- [ ] **Step 3: Migration** `packages/db/prisma/migrations/20260731100000_deliverability/migration.sql`:
```sql
CREATE TABLE "DeliverabilityProbe" (
    "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "instanceId" TEXT NOT NULL,
    "controlInstanceId" TEXT NOT NULL, "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "receivedAt" TIMESTAMP(3),
    CONSTRAINT "DeliverabilityProbe_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliverabilityProbe_token_key" ON "DeliverabilityProbe"("token");
CREATE INDEX "DeliverabilityProbe_workspaceId_instanceId_sentAt_idx" ON "DeliverabilityProbe"("workspaceId","instanceId","sentAt");
CREATE INDEX "DeliverabilityProbe_status_idx" ON "DeliverabilityProbe"("status");
ALTER TABLE "DeliverabilityProbe" ADD CONSTRAINT "DeliverabilityProbe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Instance" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Instance" ADD COLUMN "deliveryCheckedAt" TIMESTAMP(3);
ALTER TABLE "Instance" ADD COLUMN "deliveryMissStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Instance" ADD COLUMN "sendFailStreak" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4:** add `"DeliverabilityProbe",` to `TENANTED_MODELS` in `packages/db/src/tenant.ts`.

- [ ] **Step 5:** `export DATABASE_URL=postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public && pnpm --filter @evo/db exec prisma generate && pnpm --filter @evo/db exec prisma migrate deploy` → expect applied.

- [ ] **Step 6:** typecheck `pnpm --filter @evo/worker exec tsc --noEmit` → exit 0. Commit `feat(db): deliverability probe + instance health fields`.

---

## Task 2: Count hard send failures in sendViaInstance

**Files:** `packages/send/src/index.ts`, `apps/ingest/src/persist.ts`

- [ ] **Step 1:** In `sendViaInstance`, wrap the final send so a dead-session error bumps the streak. Replace the trailing:
```ts
  if (payload.type === "text") {
    return api.sendText(instance.evolutionInstanceName, { number: payload.to, text: payload.text });
  }
  return api.sendMedia(instance.evolutionInstanceName, { number: payload.to, mediatype: payload.mediatype, media: payload.mediaUrl, mimetype: payload.mimetype, caption: payload.caption, fileName: payload.fileName });
```
with:
```ts
  try {
    const result = payload.type === "text"
      ? await api.sendText(instance.evolutionInstanceName, { number: payload.to, text: payload.text })
      : await api.sendMedia(instance.evolutionInstanceName, { number: payload.to, mediatype: payload.mediatype, media: payload.mediaUrl, mimetype: payload.mimetype, caption: payload.caption, fileName: payload.fileName });
    return result;
  } catch (err: any) {
    // A dead/half-open WhatsApp session throws these on every send (Evolution 500 /
    // "Connection Closed"). Count them so the canary tick can flag send_failing.
    const msg = String(err?.message ?? err);
    if (/\b500\b|connection closed|precondition required/i.test(msg)) {
      await prisma.instance.update({ where: { id: instanceId }, data: { sendFailStreak: { increment: 1 } } }).catch(() => {});
    }
    throw err;
  }
```
(We increment only on matching errors — rare — so no per-send DB write on the success path.)

- [ ] **Step 2:** In `apps/ingest/src/persist.ts` connection handler, reset the flags when a number reconnects. Change the `evt.kind === "connection"` update's `data` to also clear health on `open`:
```ts
      data: {
        connectionState: evt.state,
        lastSeenAt: evt.state === "open" ? new Date() : undefined,
        ...(evt.state === "open" ? { sendFailStreak: 0, deliveryStatus: "unknown", deliveryMissStreak: 0 } : {}),
      },
```
(Re-pairing a dead number clears the send_failing flag promptly; deliveryStatus resets to `unknown` until the next probe confirms `ok`.)

- [ ] **Step 3:** typecheck `@evo/send` + `@evo/ingest` → exit 0. Commit `feat(send): count dead-session send failures; reset health on reconnect`.

---

## Task 3: Canary tick — probes, misses, send-fail flagging (TDD)

**Files:** create `apps/worker/src/canary-tick.ts`, modify `apps/worker/src/index.ts`, test `apps/worker/src/canary-tick.test.ts`

- [ ] **Step 1: Write failing tests** in `canary-tick.test.ts` (mirror `broadcast-scheduler.test.ts` DB setup; mock `@evo/send` `sendViaInstance` as a `vi.fn`). Cover:
  - **sends a probe** between two connected instances in a workspace (creates a `DeliverabilityProbe` with a `wasap-probe:` token and calls `sendViaInstance` from X to Y's phone), and skips a workspace with <2 connected instances.
  - **miss → flag:** a `pending` probe with `sentAt` older than 10 min and no `receivedAt` becomes `missed` and bumps `deliveryMissStreak`; a second miss sets `deliveryStatus="delivery_failing"`.
  - **send_failing:** an instance with `sendFailStreak >= 5` gets `deliveryStatus="send_failing"`.
Use `runCanaryTick(fakeQueue?, { now })` with an injectable `now` so you can place probes in the past.

- [ ] **Step 2:** run `pnpm --filter @evo/worker test canary-tick` → FAILS (module missing).

- [ ] **Step 3: Implement `apps/worker/src/canary-tick.ts`:**
```ts
import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const CANARY_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CANARY_TIMEOUT_MS = 10 * 60 * 1000;
const MISS_THRESHOLD = 2;
const SENDFAIL_THRESHOLD = 5;

export async function runCanaryTick(opts?: { now?: Date }): Promise<{ probed: number }> {
  const now = opts?.now ?? new Date();

  // 1) Resolve misses: pending probes past the timeout with no receipt.
  const stale = await prisma.deliverabilityProbe.findMany({
    where: { status: "pending", sentAt: { lt: new Date(now.getTime() - CANARY_TIMEOUT_MS) } },
  });
  for (const p of stale) {
    await prisma.deliverabilityProbe.update({ where: { id: p.id }, data: { status: "missed" } });
    const inst = await prisma.instance.update({ where: { id: p.instanceId }, data: { deliveryMissStreak: { increment: 1 }, deliveryCheckedAt: now } });
    if (inst.deliveryMissStreak >= MISS_THRESHOLD && inst.deliveryStatus !== "delivery_failing") {
      await prisma.instance.update({ where: { id: inst.id }, data: { deliveryStatus: "delivery_failing" } });
      await prisma.healthAlert.create({ data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { reason: "delivery_failing", note: "canary probes not delivered" } } as any }).catch(() => {});
    }
  }

  // 2) Flag send-failing numbers (dead session) from the send-failure streak.
  const failing = await prisma.instance.findMany({ where: { sendFailStreak: { gte: SENDFAIL_THRESHOLD }, deliveryStatus: { not: "send_failing" } } });
  for (const inst of failing) {
    await prisma.instance.update({ where: { id: inst.id }, data: { deliveryStatus: "send_failing", deliveryCheckedAt: now } });
    await prisma.healthAlert.create({ data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { reason: "send_failing", note: "repeated Evolution 500 / connection closed on send" } } as any }).catch(() => {});
  }

  // 3) Send new probes: each workspace with >=2 connected numbers probes each number
  //    that hasn't been probed within the interval, to a control (another connected number).
  let probed = 0;
  const connected = await prisma.instance.findMany({ where: { connectionState: "open" }, select: { id: true, workspaceId: true, phoneNumber: true } });
  const byWs = new Map<string, typeof connected>();
  for (const i of connected) { const a = byWs.get(i.workspaceId) ?? []; a.push(i); byWs.set(i.workspaceId, a); }
  const cutoff = new Date(now.getTime() - CANARY_INTERVAL_MS);
  for (const [, members] of byWs) {
    if (members.length < 2) continue;
    for (const x of members) {
      const recent = await prisma.deliverabilityProbe.findFirst({ where: { instanceId: x.id, sentAt: { gt: cutoff } } });
      if (recent) continue;
      // Control = the member (not x) used least-recently as a control for x.
      const controls = members.filter((m) => m.id !== x.id && m.phoneNumber);
      if (controls.length === 0) continue;
      const control = controls[0]!; // simple; refine ordering later
      const probe = await prisma.deliverabilityProbe.create({ data: { workspaceId: x.workspaceId, instanceId: x.id, controlInstanceId: control.id, token: `${probeTokenPrefix()}${x.id}-${now.getTime()}` } });
      try {
        await sendViaInstance(x.id, { type: "text", to: control.phoneNumber!, text: `wasap-probe:${probe.token}`, userId: null } as any, { origin: "warmer" });
        probed += 1;
      } catch { /* send failure already counted in sendViaInstance; probe will time out → miss */ }
    }
  }
  return { probed };
}

function probeTokenPrefix() { return "p_"; }
```
Notes: the probe body is `wasap-probe:<token>`; ingest (Task 4) matches on that. Keep the control-pick simple (first eligible) — the spec's "least-recently used" is a refinement, not required for correctness.

- [ ] **Step 4: Register the tick** in `apps/worker/src/index.ts` (mirror the health-tick block):
```ts
const CANARY_TICK_QUEUE = "canary-tick";
const canaryTickQueue = new Queue(CANARY_TICK_QUEUE, { connection });
await canaryTickQueue.add("tick", {}, { repeat: { every: 300000 }, jobId: "canary-tick:repeat" });
new Worker(CANARY_TICK_QUEUE, async () => {
  const { probed } = await runCanaryTick();
  if (probed > 0) log.info({ probed }, "canary tick");
}, { connection });
```
Add `import { runCanaryTick } from "./canary-tick.js";` at the top.

- [ ] **Step 5:** run tests → PASS; typecheck worker → exit 0. Commit `feat(worker): deliverability canary tick (probes + miss/send-fail flagging)`.

---

## Task 4: Ingest — recognise probe receipt (TDD)

**Files:** `apps/ingest/src/inbound.ts` (or wherever the normalised inbound message is handled before persist), test in `apps/ingest/src/inbound.test.ts` or a new `canary-receipt.test.ts`

- [ ] **Step 1: Write failing test:** an inbound message whose body is `wasap-probe:<token>` for an existing pending probe → the probe becomes `delivered` with `receivedAt` set, the sender instance's `deliveryStatus` becomes `ok` + `deliveryMissStreak` 0, and NO conversation/message row is created.

- [ ] **Step 2:** run → FAILS.

- [ ] **Step 3: Implement.** In the inbound receiver, right after normalising a `kind:"message"` inbound event and BEFORE `persistEvent`, add:
```ts
const probeMatch = evt.kind === "message" && evt.direction === "inbound" && typeof evt.body === "string"
  ? evt.body.trim().match(/^wasap-probe:(\S+)$/) : null;
if (probeMatch) {
  const token = probeMatch[1]!;
  const probe = await prisma.deliverabilityProbe.findUnique({ where: { token } });
  if (probe && probe.status !== "delivered") {
    await prisma.deliverabilityProbe.update({ where: { id: probe.id }, data: { status: "delivered", receivedAt: new Date() } });
    await prisma.instance.update({ where: { id: probe.instanceId }, data: { deliveryStatus: "ok", deliveryMissStreak: 0, deliveryCheckedAt: new Date() } }).catch(() => {});
  }
  return; // swallow — no conversation, no bot/autoresponder
}
```
Place it so it runs before conversation creation and any bot/autoresponder trigger. (Find the exact spot by reading `inbound.ts`; the guard must precede `persistEvent` and automation.)

- [ ] **Step 4:** run tests → PASS; typecheck ingest → exit 0. Commit `feat(ingest): recognise + swallow deliverability probe receipts`.

---

## Task 5: Exclude flagged numbers from rotator + warmer

**Files:** `apps/worker/src/broadcast-scheduler.ts`, `apps/worker/src/warmer-tick.ts`

- [ ] **Step 1 (rotator):** In `runGroupTick`, the eligibility query loads member instances by connection state. Extend the filter so flagged numbers are excluded. Where it selects the member instances (the `prisma.instance.findMany({ where: { id: { in: memberIds } }, select: { id, connectionState } })`), also select `deliveryStatus`, and in the `orderedOpen` filter require `inst.connectionState === "open" && inst.deliveryStatus !== "delivery_failing" && inst.deliveryStatus !== "send_failing"`.

- [ ] **Step 2 (warmer):** In `warmer-tick.ts` around line 200, the participant lookup is `prisma.instance.findMany({ where: { id: { in: participating }, connectionState: "open" } })`. Add `deliveryStatus: { notIn: ["delivery_failing", "send_failing"] }` to that `where`.

- [ ] **Step 3:** add/extend a scheduler test: a group member with `deliveryStatus="send_failing"` (but `connectionState="open"`) is NOT assigned any sends. Run worker tests → PASS. Typecheck. Commit `feat(worker): rotator + warmer skip delivery/send-failing numbers`.

---

## Task 6: Number Health UI badge + "Test delivery now"

**Files:** the health/instances page under `apps/web/src/app/[workspaceSlug]/…`; new route `apps/web/src/app/api/workspaces/[slug]/instances/[id]/test-delivery/route.ts`

- [ ] **Step 1: Test-delivery route** (POST) — fires an immediate probe from the instance to another connected workspace number (reuse the canary send logic; simplest: create a `DeliverabilityProbe` + `sendViaInstance` a `wasap-probe:` text, return `{ ok, controlLabel }`; if <2 connected numbers return `{ error: "NEEDS_TWO_NUMBERS" }`). Auth `requireMember(slug, "Admin")`, tenant-scoped.

- [ ] **Step 2: Badge** — wherever instances/number-health are listed, render `deliveryStatus`: `ok` → 🟢 Delivering; `unknown` → ⚪ Unchecked; `delivery_failing` → 🔴 Slow-ban suspected; `send_failing` → 🔴 Not sending (dead session), with `deliveryCheckedAt` as "checked N ago". Add a **Test delivery now** button that POSTs the route and shows the result. Follow the existing page's data-loading + component pattern.

- [ ] **Step 3:** typecheck web → exit 0. Commit `feat(ui): number-health deliverability badge + test-delivery`.

---

## Task 7: Full sweep + deploy
- [ ] Run `pnpm --filter @evo/worker test && pnpm --filter @evo/ingest test` (ignore the pre-existing `automate.test.ts` `resolveAiConfig` mock failure — confirm it's the only failure and unrelated). Typecheck web+worker+ingest → all exit 0.
- [ ] Deploy: rsync `packages/db/prisma`, `packages/db/src`, `apps/worker/src`, `apps/ingest/src`, `apps/web/src`; `docker compose build web worker ingest`; migrate from a fresh web image; `up -d web worker ingest`; verify web 200, worker + ingest started, `\d "Instance"` shows the new columns and `DeliverabilityProbe` exists.

---

## Self-Review notes
- Spec coverage: probe model + instance fields (T1), send-fail counting + reconnect reset (T2), canary probes/misses/send-fail flag (T3), probe receipt swallow (T4), rotator+warmer exclusion (T5), UI badge + manual test (T6). Both failure modes (`delivery_failing`, `send_failing`) covered.
- `HealthAlertKind`: T3/T6 use `"went_at_risk"` — verify it's a valid enum value; if not, use an existing kind or add `DELIVERY_FAILING` to the enum in T1.
- Type consistency: `deliveryStatus` string values `unknown|ok|delivery_failing|send_failing` used identically across worker, ingest, scheduler, warmer, UI. Probe body format `wasap-probe:<token>` identical in canary send (T3) and ingest match (T4).
