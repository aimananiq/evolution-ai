# Broadcast failover — continue on a backup number when one is banned

**Date:** 2026-07-20
**Status:** Approved — ready to build.

## Goal

When a broadcast's sending number gets banned/disconnected mid-send, automatically continue the remaining messages from a configured **backup number** — and re-queue the ones that failed on the dead number so nothing is lost.

## Trigger (chosen: on disconnect)

Switch when the active number's WhatsApp session is **offline** (`Instance.connectionState !== "open"`). The heartbeat (`apps/worker/src/instance-state-tick.ts`) keeps `connectionState` in sync with the engine, so this reflects a real ban/disconnect within a tick.

## Design

### Data (small migration)
Add `fallbackInstanceIds String[] @default([])` to `Broadcast` (ordered backups). `instanceId` remains the **currently-active** sender — the scheduler flips it on switch. Migration:
```sql
ALTER TABLE "Broadcast" ADD COLUMN "fallbackInstanceIds" TEXT[] NOT NULL DEFAULT '{}';
```

### Scheduler (`apps/worker/src/broadcast-scheduler.ts`)
For each `running` broadcast, before computing allowance/targets:
1. Look up the active instance's `connectionState`.
2. If **not** `open`:
   - Walk `fallbackInstanceIds` in order; pick the first whose instance is `open`.
   - **None healthy** → `continue` (defer this broadcast — wait for a number to come back; don't burn targets against dead numbers).
   - **Found** → `prisma.broadcast.update({ id, data: { instanceId: healthyId } })` and **re-queue salvage**: `broadcastTarget.updateMany({ where: { broadcastId, status: { in: ["failed","sending"] } }, data: { status: "queued", error: null } })`.
3. Continue as today, but everything (ramp allowance, the send-job `instanceId`) uses the now-active `instanceId`.

Because a switch only happens while the active number is offline, the re-queue fires once per switch (next tick the number is `open` → no re-switch). Genuinely-bad targets simply re-fail once on the healthy number — acceptable, switches are rare.

### Create route (`api/workspaces/[slug]/broadcasts/route.ts`)
Accept `fallbackInstanceIds: z.array(z.string()).default([])`; validate each belongs to the workspace (tenant-scoped `instance.findMany({ where: { id: { in: ids } } })` count === ids.length, else 400); store on create.

### Wizard (`broadcasts/new/wizard.tsx`)
Under "Send from", add **"Backup numbers (used if the first gets banned)"** — a checkbox list of the *other* connected instances (exclude the selected primary), stored in display order. Send `fallbackInstanceIds` in the create body. Theme classes.

### Visibility
The broadcast detail already shows "Send from: {instance label}". Since `instanceId` is updated on switch, it will show the number that's currently sending — no extra work needed. (A "switched to backup" note is a nice-to-have, out of scope for v1.)

## Scope / non-goals

**In:** ordered backups, disconnect-triggered switch, salvage re-queue, wizard picker, route validation.
**Out:** round-robin/load-balancing across numbers, per-number sub-quotas, auto-reconnect of the banned number, switch-back to the primary when it recovers, failure-count trigger (chose disconnect-only).

## Testing

- **Scheduler unit:** with the active instance `close` and one fallback `open`, the scheduler updates `broadcast.instanceId` to the fallback and re-queues `failed`/`sending` targets; with all instances `close`, it defers (no change); with the active `open`, no switch. Mirror the existing `broadcast-scheduler.test.ts` DB setup.
- **Route:** create with `fallbackInstanceIds` from another workspace → 400; valid ids stored.
- **Manual:** a broadcast on a number that gets disconnected mid-send moves to the backup and finishes.

## Success

A broadcast configured with a backup number keeps delivering (from the backup) after the primary number is banned, and the recipients that failed on the primary are re-sent from the backup.
