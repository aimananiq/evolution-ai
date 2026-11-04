# Ban-Health & Deliverability Suite — Design

Date: 2026-07-03
Status: Approved (direction delegated: "do what's best")

## Why

The single biggest pain in the unofficial-WhatsApp category is account bans. The 2025 ban
wave against Baileys-based tools made "will my number survive?" the first question every
buyer asks. Competitors address it with janky Chrome extensions (WAWarmer et al.) or blog
advice; nobody in the Evolution/Baileys ecosystem ships an integrated, server-side
account-health product. We already have the raw ingredients — warmer engine, per-instance
token buckets, jittered broadcast pacing, full inbound/outbound message history — but none
of it is surfaced as *health*, and nothing enforces safe volume ramps or reacts when a
number drifts into risky territory.

This suite turns those ingredients into the product's flagship differentiator:
**a per-instance health score, enforced warm-up ramps for bulk sending, automatic
protective throttling, and alerts.**

## Goals

1. Per-instance **health score (0–100)** with risk level (healthy / caution / at_risk),
   computed from signals we already store.
2. **Warm-up ramp**: an enforceable daily cap on bulk sends per instance that grows over
   time (e.g. 20/day base, +15%/day, up to a max), so new/re-paired numbers can't be
   burned by an eager broadcast.
3. **Auto-protect**: when an instance goes at-risk, automatically pause its running
   broadcasts (opt-in per instance) and raise an alert.
4. **Health dashboard**: a workspace page showing every instance's score, factors,
   today's bulk usage vs cap, score history, and alerts; per-instance policy editor.
5. Alerts also fan out through existing outbound **webhook subscriptions**.

## Non-goals (deferred)

- Changing send jitter/pacing mechanics (already shipped in broadcasts).
- Auto-creating warmer profiles for new instances (follow-up; dashboard links to warmer).
- Contact-graph analysis or on-device signals we don't have.
- Official-API (Meta) quality-rating ingestion — not applicable to Evolution instances.

## Approach

Considered:
- **A. Pure-analytics page** (score computed on page load, no enforcement) — cheap but
  toothless; doesn't prevent bans, only narrates them.
- **B. Enforcement-first, engine as a package (chosen)** — a pure `@evo/health` package
  (scoring + ramp math, fully unit-testable), Redis daily counters incremented at the
  `sendViaInstance` chokepoint, a `health-tick` worker that snapshots scores and applies
  protection, and a dashboard reading snapshots.
- **C. Full closed-loop reputation system** (dynamic per-message risk pricing, adaptive
  pacing) — over-engineered for v1; B's data model leaves room to grow into it.

B follows the codebase's established pattern: pure logic in `packages/*`, ticks in
`apps/worker`, UI + API in `apps/web`.

## Architecture

### 1. `@evo/health` package (pure logic, no I/O)

```
computeHealthMetrics(rows) -> HealthMetrics     // aggregation helpers used by the tick
computeHealthScore(metrics: HealthMetrics) -> { score: number; risk: RiskLevel; factors: Factor[] }
rampCapForDay(policy: RampPolicy, dayIndex: number) -> number
bulkSendKey(instanceId: string, date: Date) -> string   // redis key helper
```

`HealthMetrics` (trailing 7 days unless noted):
- `replyRatio` — unique contacts who sent an inbound message ÷ unique contacts we
  messaged first (business-initiated conversations). The dominant factor; WhatsApp's
  own ML is known to weight reply ratio heavily.
- `failureRate` — failed ÷ attempted broadcast targets.
- `outboundOnlyConversationPct` — conversations with ≥1 outbound and 0 inbound messages.
- `disconnectCount` — instance `connectionState` flaps recorded in the window.
- `capUsagePct` — today's bulk sends ÷ today's ramp cap (informational factor).

Scoring: weighted sum → 0–100. Weights: replyRatio 40, outboundOnly 20, failureRate 20,
disconnects 10, capUsage 10. Risk: ≥70 healthy, 40–69 caution, <40 at_risk. Instances
with fewer than 10 business-initiated conversations in the window get a neutral
`replyRatio` factor (insufficient data) rather than a punitive one.

`rampCapForDay`: `min(maxDaily, floor(baseDaily * (1 + growthPct/100)^dayIndex))`,
dayIndex = whole days since `rampStartedAt`.

### 2. Data model (packages/db)

```prisma
model InstanceHealthPolicy {        // 1:1 with Instance, created lazily with defaults
  instanceId    String  @id
  workspaceId   String
  rampEnabled   Boolean @default(false)
  rampStartedAt DateTime?
  rampBaseDaily Int     @default(20)
  rampGrowthPct Int     @default(15)
  rampMaxDaily  Int     @default(500)
  autoProtect   Boolean @default(false)   // pause running broadcasts when at_risk
}

model InstanceHealthSnapshot {      // one row per instance per UTC day, upserted by tick
  id, workspaceId, instanceId, date (DateTime @db.Date)
  score Int
  risk  HealthRisk                   // healthy | caution | at_risk
  metrics Json                       // full HealthMetrics for the factors panel
  @@unique([instanceId, date])
}

model HealthAlert {
  id, workspaceId, instanceId
  kind  HealthAlertKind              // went_at_risk | auto_protected | ramp_cap_reached
  detail Json?
  acknowledgedAt DateTime?
  createdAt
}
```

### 3. Send-path enforcement (packages/send)

`sendViaInstance(instanceId, payload, opts?)` gains `opts.origin`:
`"broadcast" | "drip" | "inbound" | "manual" | "chatbot" | "autoresponder" | "warmer" | "followup"`.
Bulk origins (`broadcast`, `drip`, `inbound`, `followup`) are counted against a Redis
daily counter (`INCR`, 48 h TTL) and **rejected with `RampCapError` when the instance's
ramp is enabled and the cap is reached**. Conversational origins (`manual`, `chatbot`,
`autoresponder`) and `warmer` are never blocked — replies and warm-up traffic build
reputation. Callers are updated to pass their origin; omitted origin behaves as `manual`
(never blocked) so nothing breaks.

The broadcast scheduler additionally pre-checks remaining allowance
(`remainingBulkToday`) and only enqueues that many targets per tick, deferring the rest
to the next window — so cap exhaustion parks the broadcast rather than generating a
wave of failed targets. A broadcast-send job that still hits `RampCapError` re-queues the
target as `queued` (not `failed`).

### 4. `health-tick` worker (apps/worker, every 15 min)

For each instance: aggregate metrics via Prisma + Redis counter, `computeHealthScore`,
upsert today's snapshot. On risk transition into `at_risk`: create `went_at_risk` alert +
emit `health.at_risk` webhook event; if `autoProtect`, set the instance's `running`
broadcasts to `paused`, create `auto_protected` alert, emit `health.auto_protected`.
Disconnect flaps are counted by comparing `connectionState` transitions observed by the
tick (stored in the day's snapshot metrics).

### 5. Web UI + API (apps/web)

- **Page `/[workspaceSlug]/health`** ("Number Health" in sidebar): one card per instance —
  score dial, risk badge, factor breakdown, today's bulk usage vs cap, 14-day score
  sparkline, recent alerts with acknowledge, and a policy editor (ramp on/off, base,
  growth, max, auto-protect). Empty/insufficient-data states included. Link to Warmer
  ("improve this score") when reply ratio is the weak factor.
- **API routes** under `/api/workspaces/[slug]/health`:
  - `GET /health` — all instances: latest snapshot + policy + today's usage.
  - `GET /health/instances/[id]` — snapshot history (14 d) + alerts.
  - `PUT /health/instances/[id]/policy` — upsert policy (Admin+).
  - `POST /health/alerts/[id]/ack` — acknowledge (Agent+).
- Instance detail page gets a health chip linking to the dashboard.

### 6. Webhook events

New event kinds on existing `WebhookSubscription` fan-out: `health.at_risk`,
`health.auto_protected`, `health.ramp_cap_reached`.

## Error handling

- Redis unavailable → counter/cap checks fail open (send proceeds) but log; health tick
  skips the cycle rather than writing bogus snapshots.
- Score computation with sparse data → neutral factors, `insufficient_data` flag in
  metrics JSON, UI shows "gathering data" instead of a scary number.
- Ramp cap race (concurrent sends): Redis `INCR` is atomic; a small overshoot (≤ worker
  concurrency) is acceptable and documented.

## Testing

- `@evo/health`: unit tests for scoring weights, risk boundaries, insufficient-data
  neutrality, ramp math (day 0, growth compounding, max clamp).
- `packages/send`: origin counting, cap rejection, fail-open on Redis error.
- `apps/worker`: health-tick snapshot upsert, at-risk transition alerting, auto-protect
  pausing broadcasts; scheduler allowance pre-check.
- `apps/web`: API route auth/validation tests following existing route-test patterns.
