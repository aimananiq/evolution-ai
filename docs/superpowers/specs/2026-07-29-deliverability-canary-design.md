# Deliverability canary — detect "slow-banned" numbers

**Date:** 2026-07-29
**Status:** Approved (design + open points decided) — ready to plan.

## Problem

A WhatsApp number can be **slow-banned**: it stays `connected` and the send API returns `success` + a messageId, but WhatsApp **silently drops delivery** on the linked-device (WhatsApp Web / Evolution) channel while the phone still works. This is invisible — no error, no ack, no WhatsApp "you're banned" signal. Confirmed live: `601158623510` accepts every API send (status `PENDING`) and delivers nothing, while a healthy number on the same server delivers fine.

Passive detection is impossible in this stack: Evolution's stored message status stays `PENDING` (LID ack-matching gap), the app receives **0 `message.status` webhooks**, and API/broadcast sends aren't recorded per-message. So we can't read delivery from acks.

## Approach: actively test delivery (canary probe)

Instead of reading acks, **measure delivery directly**: periodically have each connected number send a tiny marked probe to a **control number the workspace owns** (another of its connected numbers). The **inbound** path is reliable (incoming messages create conversations), so we can observe whether the probe **arrived**. Arrived → the number delivers. Didn't arrive within a window → the number is slow-banned.

This turns an invisible ban into a hard yes/no signal, and plugs into the existing Number Health + the rotator's eligibility.

## Decided design points

- **Control number:** another **connected** instance in the *same workspace* (no external/dedicated number). Requires ≥2 connected numbers; workspaces with <2 connected numbers simply don't run canaries (surfaced in the UI). Pick the control that was least-recently used as a control for this sender, to spread load and avoid always probing the same pair.
- **Cadence:** each connected instance is probed at most once per **`CANARY_INTERVAL` = 4h** (skip if a probe for it exists within the interval).
- **Timeout:** a probe still unreceived after **`CANARY_TIMEOUT` = 10 min** is a **miss**.
- **Flag threshold:** **2 consecutive misses** → the instance is flagged **`delivery_failing`** (slow-ban suspected). One delivered probe clears the streak.
- **Probe content:** a single hidden text `wasap-probe:<probeId>` (no media, no template). Ingest recognises the prefix, marks the probe delivered, and **suppresses it** (no inbox conversation, no notification, no bot/autoresponder).

## Data model

```prisma
model DeliverabilityProbe {
  id                String   @id @default(cuid())
  workspaceId       String
  instanceId        String   // sender under test
  controlInstanceId String   // receiver (another number in the workspace)
  token             String   @unique          // the probeId echoed in the body: "wasap-probe:<id>"
  status            String   @default("pending") // pending | delivered | missed
  sentAt            DateTime @default(now())
  receivedAt        DateTime?
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, instanceId, sentAt])
  @@index([status])
}
```

Add to `Instance`: `deliveryStatus String @default("unknown")` (`unknown | ok | delivery_failing | send_failing`), `deliveryCheckedAt DateTime?`, `deliveryMissStreak Int @default(0)`, and `sendFailStreak Int @default(0)`.

## Two failure modes (both flag the same `deliveryStatus`)

Real numbers fail in two distinct ways — the feature detects both:

1. **Slow-ban** — the number is `open`, sends return `success`, but WhatsApp silently drops delivery. Invisible from our side except by *measuring* delivery → the **canary probe** below. Flags `delivery_failing`.
2. **Dead session** — the linked WhatsApp session is dead: sends throw hard errors (`Evolution 500` / "Connection Closed"), yet `connectionState` can still read a stale `"open"` (the S21 Ultra case: 485 failed sends over a day while shown "connected", `lastSeenAt` weeks old). Detected by **watching the send-failure rate** → the passive detector below. Flags `send_failing`.

## Components

### Worker — canary scheduler (`apps/worker/src/canary-tick.ts`, new; repeat tick like the others)
Every tick (e.g. 5 min):
1. **Send probes:** for each workspace with ≥2 connected instances, for each connected instance `X` with no probe in the last `CANARY_INTERVAL`: pick control `Y` (least-recently control for X), create a `DeliverabilityProbe`, and `sendViaInstance(X, { text: "wasap-probe:<probeId>", to: Y.phone })`. Store `token`.
2. **Resolve misses:** probes `pending` older than `CANARY_TIMEOUT` → `missed`; bump `X.deliveryMissStreak`; if streak ≥ 2 → `X.deliveryStatus = "delivery_failing"` and raise a `HealthAlert` (reuse the existing alert model/kind). A `delivered` probe sets `deliveryStatus = "ok"`, resets the streak.

### Ingest — probe receipt (`apps/ingest/src/…`)
In the inbound path, before normal message handling: if an inbound text body matches `^wasap-probe:(\w+)$`, find the `DeliverabilityProbe` by token, set `receivedAt = now`, `status = "delivered"`, update the sender's `deliveryStatus = "ok"` / reset streak, and **return early** (do not create a conversation, notify, or trigger the bot/autoresponder).

### Send-failure detector (dead session) — `packages/send` + `apps/worker/src/canary-tick.ts`
`sendViaInstance` already throws on Evolution errors. On a caught send error whose message matches `/500|connection closed|precondition required/i`, increment `Instance.sendFailStreak`; on any successful send, reset it to 0. In the canary tick, any instance with `sendFailStreak >= 5` gets `deliveryStatus = "send_failing"` + a `HealthAlert`, and the tick also re-checks that instance's **live** `connectionState` via Evolution (catching the stale-`open` case) and corrects the DB. This gives fast detection of the S21-Ultra failure without waiting for a canary cycle.

### Rotator + warmer eligibility
In `runGroupTick` (`broadcast-scheduler.ts`), the eligible set already filters `connectionState === "open"` + ramp allowance. **Also exclude** instances whose `deliveryStatus` is `delivery_failing` or `send_failing`. The warmer's participant selection (`warmer-tick.ts`) applies the same exclusion, so it stops hammering a dead number (the 485-failed-sends case). Single-number broadcast mode: if the chosen instance is flagged, still send (explicit user choice) but surface a warning in the UI.

### UI — Number Health (`apps/web/src/app/[workspaceSlug]/…/health` or the instance page)
Per-number badge: 🟢 **Delivering** (`ok`) · ⚪ **Unchecked** (`unknown`, or <2 numbers) · 🔴 **Slow-ban suspected — deliverability failing** (`delivery_failing`), with "last confirmed delivery: N ago." A workspace with <2 connected numbers shows "Add a second number to enable delivery checks." Optionally a manual **"Test delivery now"** button that fires an immediate probe.

## Testing

- **Ingest unit:** an inbound `wasap-probe:<token>` marks the matching probe delivered, resets the sender's streak to `ok`, and does NOT create a conversation.
- **Canary miss:** a probe older than the timeout with no receipt → `missed`; two consecutive misses → `delivery_failing` + alert; a later delivered probe → `ok`, streak 0.
- **Control selection:** picks a connected same-workspace instance other than the sender; skips workspaces with <2 connected instances.
- **Rotator:** a `delivery_failing` member is excluded from `runGroupTick` eligibility even when `connectionState === "open"`.

## Non-goals (v1)

- External/dedicated monitor numbers (reuse own numbers only).
- Per-recipient delivery tracking of real traffic (that's the separate report feature; the canary is per-number deliverability, not per-message).
- Auto-recovery scheduling / auto-warmup of a flagged number (we flag + skip; recovery is manual rest).
- Detecting cold-vs-existing-contact nuance (probe to own numbers is treated as the deliverability signal).

## Success

A number that accepts sends but stops delivering is **flagged within ~1–2 canary cycles**, shown clearly in Number Health, and **auto-skipped by the rotator** — so a slow-ban no longer silently swallows a campaign.
