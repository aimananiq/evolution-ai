# Broadcast Report + Retry (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On a broadcast, show a per-recipient report (status + which number sent + error), and let the user **blast the remaining / retry failed** on a chosen number or group — plus per-row resend, CSV export of failures, live progress/ETA, and pause/resume.

**Architecture:** New paginated targets API + retry/resend/pause/resume routes reusing the existing broadcast engine (re-queue targets → status `running` → the scheduler picks them up). The detail page (`detail-view.tsx`, already a polling client component) gains a report table + controls. No schema changes — `BroadcastTarget` already has `status/error/instanceId/sentAt` and `BroadcastStatus` already has `paused`; the scheduler only loads `running` broadcasts so `paused` is auto-skipped. Spec: `docs/superpowers/specs/2026-07-28-broadcast-rotator-and-report-design.md` (Phase 2).

**Tech Stack:** Next.js 15 API routes + React client, Prisma, Vitest. Conventions: `requireMember`, `tenantClient`, `AppError`, `writeAudit` (see `.../broadcasts/[id]/cancel/route.ts`). Commit after each task.

**Key facts:**
- `BroadcastTarget`: `{ id, broadcastId, contactId, status (queued|sending|sent|delivered|read|failed), error, instanceId, sentAt, evolutionMessageId, contact }`.
- Broadcast sender fields (from Phase 1): `instanceId`, `fallbackInstanceIds`, `instanceGroupId`, `groupSendMode`, `rotateEvery`, `groupState`, `nextSlotAt`, `intervalMinSec/MaxSec`.
- `detail-view.tsx` polls `GET /broadcasts/[id]` → `{ broadcast, totals }` via `refresh()`.
- Retry semantics: re-queue matching targets to `status:"queued", error:null, instanceId:null`; set the broadcast's sender fields to the chosen number/group; reset `nextSlotAt:null` + `groupState:null`; set `status:"running"`. Already-`sent` targets are never touched (no duplicate sends).

---

## Task 1: Targets list + CSV API

**Files:** create `apps/web/src/app/api/workspaces/[slug]/broadcasts/[id]/targets/route.ts`

- [ ] **Step 1: Implement GET.** Query params: `status` (`all|not_sent|failed|sent`, default `all`), `q` (name/phone search), `page` (default 1, size 50), `format` (`json|csv`).
  - Auth `requireMember(slug, "Viewer")`, `tenantClient`.
  - Map `status`: `not_sent` → `{ in: ["queued","sending"] }`; `failed` → `"failed"`; `sent` → `{ in: ["sent","delivered","read"] }`; `all` → no status filter.
  - `where = { broadcastId: id, ...(statusFilter), ...(q ? { contact: { OR: [{ name: { contains: q, mode: "insensitive" } }, { phoneE164: { contains: q } }] } } : {}) }`.
  - Load a map of the workspace's instance labels (`db.instance.findMany({ select: { id, label } })`) to resolve `instanceId` → label.
  - JSON: `{ targets: [{ id, name, phone, status, instanceLabel, error, sentAt }], total, page, byInstance: [{ instanceId, label, sent, failed }] }` where `byInstance` is a `groupBy(['instanceId','status'])` aggregated to sent/failed per number.
  - CSV (`format=csv`, and typically `status=failed`): stream `phone,name,status,error` with `content-disposition: attachment; filename="broadcast-<id>-<status>.csv"` (reuse the `toCsv` pattern from `export-participants/route.ts`).
```ts
// pagination
const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
const take = 50; const skip = (page - 1) * take;
const [targets, total] = await Promise.all([
  db.broadcastTarget.findMany({ where, include: { contact: { select: { name: true, phoneE164: true } } }, orderBy: [{ status: "asc" }, { sentAt: "desc" }], take, skip }),
  db.broadcastTarget.count({ where }),
]);
```
- [ ] **Step 2:** typecheck web → exit 0. Commit `feat(api): broadcast per-recipient targets list + CSV export`.

---

## Task 2: Retry + per-row resend API

**Files:** create `.../broadcasts/[id]/retry/route.ts` and `.../broadcasts/[id]/targets/[targetId]/retry/route.ts`

- [ ] **Step 1: `POST /broadcasts/[id]/retry`.** Body (zod): `{ scope: "failed" | "remaining", instanceId?: string, instanceGroupId?: string|null, groupSendMode?: "parallel"|"rotate", rotateEvery?: number, intervalMinSec?: number, intervalMaxSec?: number }`. Auth `Admin`.
  - Load broadcast (404 if missing).
  - Validate the chosen sender (reuse the create-route logic): if `instanceGroupId`, verify it belongs to the workspace and has ≥1 member + a `groupSendMode`, set `instanceId` to the first member; else verify `instanceId` belongs to the workspace.
  - Re-queue: `db.broadcastTarget.updateMany({ where: { broadcastId: id, status: scope === "failed" ? "failed" : { in: ["failed","queued"] } }, data: { status: "queued", error: null, instanceId: null } })`. (Never touches sent/delivered/read.)
  - If 0 re-queued → return `{ ok: true, requeued: 0 }` (nothing to do).
  - Update the broadcast: sender fields (`instanceId`, `instanceGroupId ?? null`, `groupSendMode`, `rotateEvery`, `intervalMinSec/MaxSec` when provided, `fallbackInstanceIds: instanceGroupId ? [] : broadcast.fallbackInstanceIds`), reset `nextSlotAt: null, groupState: null`, `status: "running", completedAt: null`.
  - `writeAudit` action `broadcast.retried`. Return `{ ok: true, requeued }`.
- [ ] **Step 2: `POST /broadcasts/[id]/targets/[targetId]/retry`.** Auth `Admin`. Re-queue ONE target: `updateMany({ where: { id: targetId, broadcastId: id }, data: { status: "queued", error: null, instanceId: null } })`, set broadcast `status: "running", completedAt: null` (if it was completed). Return `{ ok: true }`.
- [ ] **Step 3:** typecheck web → exit 0. Commit `feat(api): broadcast retry / blast-remaining + per-row resend`.

---

## Task 3: Pause / Resume API

**Files:** create `.../broadcasts/[id]/pause/route.ts` and `.../broadcasts/[id]/resume/route.ts` (mirror `cancel/route.ts`)

- [ ] **Step 1: pause** — `POST`, Admin: if broadcast `status === "running"` set `status: "paused"`; else return `{ error: "NOT_RUNNING" }` 400. Audit `broadcast.paused`. (The scheduler only loads `running`, so this halts enqueuing; already-delayed jobs in Redis still fire — acceptable.)
- [ ] **Step 2: resume** — `POST`, Admin: if `status === "paused"` set `status: "running"` and `nextSlotAt: null` (resume promptly); else `{ error: "NOT_PAUSED" }` 400. Audit `broadcast.resumed`.
- [ ] **Step 3:** typecheck web → exit 0. Commit `feat(api): broadcast pause/resume`.

---

## Task 4: Report table on the detail page

**Files:** modify `apps/web/src/app/[workspaceSlug]/broadcasts/[id]/detail-view.tsx`

- [ ] **Step 1:** Add state + fetch for the targets report. Below the existing totals cards, add:
  - **Filter tabs**: All · Not sent · Failed · Sent (map to the `status` param). A search box (`q`, debounced ~300ms). Reset to page 1 on filter/search change.
  - A `fetchTargets()` that GETs `/api/workspaces/${slug}/broadcasts/${id}/targets?status=${filter}&q=${q}&page=${page}` and stores `{ targets, total, byInstance }`. Call it on mount and whenever filter/q/page change, and inside the existing `refresh()` poll so it stays live.
  - **Per-number breakdown** (from `byInstance`): a small row of chips "iphone 11: 74 sent · 2 failed" so a banned number is obvious.
  - **Table**: Name · Phone · Status (colored pill) · Number used (`instanceLabel`) · Error · Sent-at. Paginate with Prev/Next (`total`/50). Empty state per filter.
  Match the page's existing styling (Card, StatusPill, Button).
- [ ] **Step 2:** typecheck web → exit 0. Commit `feat(ui): broadcast per-recipient report table + filters + per-number breakdown`.

---

## Task 5: Retry/resend/export controls + progress/ETA + pause/resume + sweep + deploy

**Files:** modify `detail-view.tsx`

- [ ] **Step 1: Blast-remaining / retry-failed control.** A button that opens a compact **Send-from picker** modal: radio **Single number** (dropdown of the workspace instances — fetch `GET /instances`) OR **Group** (dropdown of groups with members — fetch `GET /instance-groups`, then parallel/rotate + rotate-every), plus the **speed presets** (Low/Medium/High/Custom — copy the preset gaps from the wizard: low 45–90, medium 20–45, high 8–20). A **Scope** toggle: *Retry failed only* vs *Blast all remaining (failed + not-yet-sent)*. On submit → `POST /broadcasts/[id]/retry` with the chosen fields; on success refresh + close.
- [ ] **Step 2: Per-row resend** — a small "Resend" button on each `failed` row → `POST /broadcasts/[id]/targets/[targetId]/retry` → refresh.
- [ ] **Step 3: Export failed** — a link/button → open `/api/workspaces/${slug}/broadcasts/${id}/targets?status=failed&format=csv` (download).
- [ ] **Step 4: Progress bar + ETA** — from totals: `done = sent+delivered+read+failed`, `total = done+queued+sending`; render a progress bar `done/total`. ETA (when `running` and `queued>0`): `queued × avgGap` where `avgGap` = `((intervalMinSec+intervalMaxSec)/2)` (fetch these from the `GET /broadcasts/[id]` broadcast object; divide by the group's parallel fan-out if `groupSendMode==="parallel"` — the broadcast object should expose `instanceGroupId`/`groupSendMode`; if not readily available, show ETA for single/rotate only). Format with a small `formatDuration` (copy from the wizard).
- [ ] **Step 5: Pause / Resume buttons** — when `status==="running"` show **Pause** (`POST …/pause`); when `paused` show **Resume** (`POST …/resume`). Refresh after.
- [ ] **Step 6:** typecheck web → exit 0. Commit `feat(ui): broadcast blast-remaining/retry/resend/export + progress/ETA + pause-resume`.
- [ ] **Step 7: Sweep + deploy.** `pnpm --filter @evo/web exec tsc --noEmit` (+ worker/ingest unaffected). Deploy web only (no schema/worker change): rsync `apps/web/src`, `docker compose build web`, `up -d web`, verify web 200 and the report renders on a broadcast.

---

## Self-Review notes
- No schema/migration (all fields + `paused` status already exist). Worker/ingest untouched → web-only deploy.
- Retry never touches `sent/delivered/read` targets → no duplicate sends. Group retry clears `fallbackInstanceIds` + `groupState`, mirroring create.
- Type consistency: status-filter mapping (`not_sent|failed|sent|all`) identical between the targets API (T1) and the report tabs (T4). Retry body field names match the create route + wizard (`instanceGroupId`, `groupSendMode`, `rotateEvery`, `intervalMinSec/MaxSec`).
- Reuses the existing polling `refresh()` so the report + progress stay live without new infra.
