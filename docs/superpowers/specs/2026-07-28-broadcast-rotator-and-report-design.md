# Broadcast instance rotator + detailed report/retry — design

**Date:** 2026-07-28
**Status:** Approved — ready to plan.

## Goal

Make broadcasting resilient when a single number gets banned mid-blast (the recurring failure: one campaign showed 26 sent / 224 failed after the sender was disconnected). Two cohesive capabilities:

1. **Instance groups + rotator** — group numbers, and blast a campaign across a whole group either **in parallel** (fast) or **one-at-a-time with an N-lead rotation** (spread the load). The group auto-skips banned/exhausted numbers, giving failover for free.
2. **Detailed report + retry** — on a broadcast, see every recipient's status and which number sent it, then **blast the remaining / retry failed** on a chosen number or group, with per-row resend and CSV export.

Built on the existing broadcast engine: `Broadcast.instanceId` + `fallbackInstanceIds` (single-number failover), cumulative pacing cursor (`nextSlotAt`), per-instance warm-up ramp (`remainingBulkToday`), and the Low/Medium/High/Custom speed presets in the wizard.

## Implementation phases

- **Phase 1 — Rotator:** schema (groups + broadcast group fields + `BroadcastTarget.instanceId`), group CRUD (API + UI), wizard "Send from" changes, scheduler engine (parallel + rotate).
- **Phase 2 — Report/retry:** per-recipient report table + filters, "blast remaining"/retry with number-or-group choice, per-row resend, CSV export, plus extras (progress bar + ETA, pause/resume, per-number breakdown).

Each phase is independently shippable and gets its own implementation plan.

---

## Data model

### New models

```prisma
model InstanceGroup {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  workspace   Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  members     InstanceGroupMember[]
  broadcasts  Broadcast[]
  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model InstanceGroupMember {
  groupId    String
  instanceId String
  group      InstanceGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  instance   Instance      @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  @@id([groupId, instanceId])
  @@index([instanceId])
}
```

- `Instance` gains back-relation `groupMemberships InstanceGroupMember[]`; `Workspace` gains `instanceGroups InstanceGroup[]`.
- `InstanceGroup` is added to `TENANTED_MODELS` (it has `workspaceId`). `InstanceGroupMember` has no `workspaceId`; it is only ever reached through a tenant-scoped group, and every query that touches it first resolves the group via `tenantClient`.

### Broadcast additions

```prisma
instanceGroupId String?   // set = blast by group; null = single-number mode (as today)
groupSendMode   String?   // "parallel" | "rotate"  (null unless instanceGroupId set)
rotateEvery     Int?      // rotate mode: leads one number sends before rotating (default 20)
groupState      Json?     // scheduler-managed: { cursors: {instanceId: epochMs}, activeInstanceId, sentInCycle }
instanceGroup   InstanceGroup? @relation(fields: [instanceGroupId], references: [id], onDelete: SetNull)
```

- `instanceId` stays **required** — in group mode it holds the group's first/primary number (valid FK, used for display). The scheduler drives actual per-lead assignment from the group, not from `instanceId`.
- `fallbackInstanceIds` is used **only** in single-number mode. Group mode's failover is "skip ineligible members."
- `groupState` is opaque to everything except the scheduler.

### BroadcastTarget addition

```prisma
instanceId String?   // the number that sent/attempted this target — powers the report + rotator failover
```

Set by the scheduler when it assigns a target to a number (at `status → sending`). Nullable for legacy rows.

Migrations: one additive migration per model change, following the `YYYYMMDDHHMMSS_name` convention already in `packages/db/prisma/migrations`. All columns nullable / defaulted → backward compatible.

---

## Phase 1 — Rotator

### Group management UI

A **Groups** panel on the Instances page (`apps/web/src/app/[workspaceSlug]/instances/`):
- Create a group (name).
- Toggle which numbers belong (checkbox list of the workspace's instances; a number may be in several groups).
- Each member row shows its live health (connection state) so the user sees at a glance if a group has healthy numbers.
- Rename / delete a group.

API routes (mirror the existing `lists` routes' shape and auth):
- `GET/POST /api/workspaces/[slug]/instance-groups` — list / create.
- `GET/PUT/DELETE /api/workspaces/[slug]/instance-groups/[id]` — read / rename / delete.
- `POST/DELETE /api/workspaces/[slug]/instance-groups/[id]/members` — add / remove members (`{ instanceIds: [...] }`).

### Wizard "Send from" changes

`apps/web/src/app/[workspaceSlug]/broadcasts/new/wizard.tsx`:
- Radio: **Single number** | **Group**.
  - **Single number** → existing instance dropdown + "Backup numbers" (failover), unchanged.
  - **Group** → group dropdown, then:
    - Send mode radio: **Parallel (all numbers at once)** | **One at a time (rotate)**.
    - If **rotate**: numeric "Rotate after **N** messages" (default 20).
- The existing **speed presets** (Low/Medium/High/Custom) and the **time estimate** stay. The estimate becomes group-aware:
  - Parallel: `recipients × gap ÷ eligibleCount` (bounded below by one gap).
  - Rotate / single: `recipients × gap` (one number active at a time).

Create route (`api/workspaces/[slug]/broadcasts/route.ts`) accepts `instanceGroupId`, `groupSendMode`, `rotateEvery`; validates the group belongs to the workspace and has ≥1 member; sets `instanceId` to the first member (valid FK). Mutually exclusive with `fallbackInstanceIds`.

### Scheduler engine

`apps/worker/src/broadcast-scheduler.ts` — branch on `instanceGroupId`.

**Eligibility (group mode, computed each tick):** the group's members that are `connectionState === "open"` **and** have `remainingBulkToday(instanceId) !== 0` (null = unlimited), in membership order. Empty → `continue` (defer; all numbers down/exhausted).

**Group failover (pre-step):** re-queue `sending` targets whose `instanceId` is **not** in the current eligible set (their number dropped) → `status: "queued", error: null`. Genuinely-failed targets (`status: "failed"`) are left for manual retry (Phase 2), preventing retry loops on bad numbers.

**Per-lead assignment** (respecting the existing 10-min `SCHEDULE_HORIZON_MS` and per-instance remaining-allowance counters tracked locally in the tick):
- **Parallel:** pick the eligible number whose pacing cursor is earliest (soonest free); tie-break by membership order. Each number keeps its own cursor in `groupState.cursors[instanceId]`, so numbers send concurrently, each at its own gap.
- **Rotate:** send from `groupState.activeInstanceId` (default: first eligible). After `rotateEvery` leads in the cycle (`groupState.sentInCycle`), advance to the next eligible number (skipping ineligible), reset `sentInCycle`, and reset that number's cursor to now. One number active at a time.

For each assigned target: `slot = max(now, cursor[instId]) + gap`; if `slot - now > horizon` break; set `cursor[instId] = slot`; update target `status: "sending", instanceId: instId`; enqueue the send job with that `instanceId` and `delay = slot - now`. Persist `groupState` after the tick.

**Single-number mode** keeps today's behavior exactly (failover via `fallbackInstanceIds` + single `nextSlotAt` cursor).

`computeSendDelayMs` (the gap from the speed preset) is unchanged and shared by both modes.

### Phase 1 testing

DB-backed scheduler tests (mirror `broadcast-scheduler.test.ts`):
- **Parallel** distributes queued targets across ≥2 eligible numbers, each job carries a distinct assigned `instanceId`, and each number's successive delays are spaced by ≥ one gap (per-instance pacing).
- **Rotate** assigns the first `rotateEvery` targets to number A, then switches to number B; `groupState.sentInCycle` resets on switch.
- **Eligibility** skips a `close` or ramp-exhausted member.
- **Group failover** re-queues a `sending` target whose `instanceId` became ineligible.
Route tests: group CRUD (create/add members/validation that members belong to the workspace); broadcast create with `instanceGroupId` + mode.

---

## Phase 2 — Detailed report + retry

### Report on the broadcast detail page

`apps/web/src/app/[workspaceSlug]/broadcasts/[id]/` — below the existing summary counts:
- **Per-recipient table**: Name · Phone · Status (sent / failed / queued=“not sent yet” / sending) · **Number used** (instance label) · Error reason · Sent-at.
- **Filter tabs**: All · Not sent · Failed · Sent. Search by name/number. Server-side paginated.
- **Per-number breakdown**: a small summary of sent/failed grouped by the number used (spot a banned number instantly).

API: `GET /api/workspaces/[slug]/broadcasts/[id]/targets?status=&q=&page=` → paginated `{ targets: [{ id, name, phone, status, instanceLabel, error, sentAt }], total, byInstance: [...] }`.

### Retry / blast-remaining

- **"Blast remaining" / "Retry failed"** action on the detail page opens the same **Send-from picker** (single number ＋ backup, or group → parallel/rotate + N) and **speed preset**, then:
  - `POST /api/workspaces/[slug]/broadcasts/[id]/retry` with `{ scope: "failed" | "remaining", instanceId? , instanceGroupId?, groupSendMode?, rotateEvery?, intervalMinSec?, intervalMaxSec? }`.
  - Re-queues the matching targets (`failed` for scope=failed; `failed`+`queued` for scope=remaining) → `status: "queued", error: null, instanceId: null`; updates the broadcast's sender fields to the chosen number/group; resets `nextSlotAt`/`groupState`; sets `status: "running"`. The scheduler resumes them. Already-`sent` recipients are never re-sent (no duplicates).
- **Per-row resend**: `POST /api/workspaces/[slug]/broadcasts/[id]/targets/[targetId]/retry` re-queues one recipient (on the broadcast's current sender).
- **Export failed as CSV**: `GET …/broadcasts/[id]/targets?status=failed&format=csv` streams `phone,name,error`.

### Extras

- **Progress bar + ETA** on a running/paused broadcast — from counts + the chosen gap (and eligible-number count for parallel). Client-computed; the detail page already polls counts.
- **Pause / Resume** — add `status: "paused"`; the scheduler skips `paused` broadcasts; `POST …/broadcasts/[id]/pause` and `…/resume`. (Cancel already exists.)

### Phase 2 testing

- Retry route: scope=failed re-queues only failed; scope=remaining re-queues failed+queued; never touches `sent`; switching to a group sets group fields + resets `groupState`.
- Targets route: pagination + status filter + CSV format.
- Pause: a `paused` broadcast enqueues nothing; resume continues.

---

## Non-goals (v1)

- Weighted rotation or per-number custom gaps (all numbers share the campaign's speed preset).
- Auto-rebalancing already-scheduled delayed jobs when a number recovers mid-flight (we skip ineligible on assignment and re-queue in-flight on drop; we don't reshuffle jobs already delayed in Redis).
- Cross-workspace groups; nesting groups.
- Automatic retry of genuinely-failed (invalid-number) targets — retry is user-initiated.

## Success

- A campaign sent to a **group** keeps delivering across healthy numbers when one gets banned — in **parallel** (≈ N× throughput, each number safe) or **rotate** (one number at a time, N leads per cycle), respecting each number's warm-up ramp and the chosen speed preset.
- After any broadcast, the user can **see exactly which recipients didn't get it and why**, then **blast the remaining on a different number or group** in a couple of clicks — no re-import, no duplicate sends.
