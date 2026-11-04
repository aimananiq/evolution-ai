# Outbound Webhook Delivery Pipeline (n8n / Zapier / Make / Sheets) — Design

Date: 2026-07-04
Status: Approved (direction delegated — "complete all of it, don't forget n8n")

## Why

`WebhookSubscription` records can be configured in the UI, but nothing delivers them
(except the inline health emitter I added earlier). No-code tools — **n8n**, Zapier,
Make, Google Sheets — integrate by consuming signed webhooks. Shipping a real,
signed, retrying delivery pipeline turns those configured URLs into a working
integration surface and is the core enabler for n8n.

## Goal

When a subscribed event happens (message.received, message.status, instance.state,
broadcast.completed, broadcast.failed, health.*), every enabled matching subscription
receives an HMAC-signed HTTP POST, with retries and a delivery log. Health events move
onto the same pipeline (unifying signing + retries + logging).

## Architecture

Two BullMQ queues so hot emit paths stay cheap and per-subscription failures retry in
isolation:

- **`webhook-fanout`** — emit points enqueue one lightweight job `{ workspaceId, event,
  data, at }`. The fanout processor loads enabled subscriptions matching `event` and
  enqueues one deliver job each. (No DB work on the emit path beyond enqueue.)
- **`webhook-deliver`** — job `{ subscriptionId, workspaceId, url, secret, event, body }`.
  POSTs `body` with signature headers; on non-2xx / network error it throws so BullMQ
  retries (attempts 5, exponential backoff). Each attempt writes a `WebhookDeliveryLog`.

### `@evo/webhooks` package

- Pure (unit-tested): `matchingSubs(subs, event)`, `buildDelivery(workspaceId, event,
  data, now)` → `{ body, event, at }`, `signatureHeader(body, secret)` (delegates to
  crypto HMAC).
- IO: `emitWebhook(workspaceId, event, data)` (lazy `webhook-fanout` Queue),
  `runWebhookFanout(job)`, `deliverWebhook(job)`. Queue-name constants exported.
- Signature: `x-webhook-signature: sha256=<hex>` = HMAC-SHA256 of the raw body;
  `x-webhook-event`, `x-webhook-id`, `x-webhook-timestamp` headers. Verifiable in n8n
  with a Crypto/Function node or in any consumer.

### `@evo/crypto`

Add `hmacSha256Hex(payload, secret)` (Node `createHmac`). Pure, unit-tested.

### Data model

```prisma
model WebhookDeliveryLog {
  id             String   @id @default(cuid())
  workspaceId    String
  subscriptionId String?
  event          String
  url            String
  ok             Boolean
  statusCode     Int?
  error          String?
  createdAt      DateTime @default(now())
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, createdAt])
}
```
Registered in `TENANTED_MODELS`.

### Emit points

- `message.received` — `apps/ingest/src/index.ts`, for inbound persisted messages
  (payload: instanceId, conversationId, from, body, type, at).
- `message.status` — `apps/ingest/src/persist.ts` message-status branch (evolutionMessageId, status).
- `instance.state` — `apps/ingest/src/persist.ts` connection branch (instanceId, state).
- `message.sent` — `apps/web/.../conversations/[id]/messages` route after a successful
  agent reply (conversationId, to, textPreview). (Broadcast per-target sends are not
  emitted individually — `broadcast.completed` summarises campaigns.)
- `broadcast.completed` — `apps/worker/src/broadcast-scheduler.ts` on completion, with
  `{ broadcastId, name, sent, failed, total }`. Additionally emit **`broadcast.failed`**
  when `failed > 0` (partial-failure alerting).
- `health.*` — `apps/worker/src/health-tick.ts` switches from its inline emitter to
  `emitWebhook`.

Every emit is best-effort: enqueue failures are swallowed and never block the caller.

### Worker

Register `webhook-fanout` (concurrency 8) and `webhook-deliver` (concurrency 8, attempts
5, exponential backoff) workers in `apps/worker/src/index.ts`.

### UI + docs

- Add `health.*` to the webhooks form's event list, plus a one-line hint: "Works with
  n8n, Zapier, Make, and Google Sheets — every delivery is HMAC-signed
  (`x-webhook-signature`)."
- Recent-deliveries panel: a `GET .../webhook-subscriptions/logs` endpoint + a compact
  list under the form so users can debug n8n wiring.
- `docs/integrations/webhooks.md`: event catalogue, payload shape, signature
  verification, and an n8n setup walkthrough (Webhook trigger node + HMAC verify).

## Error handling

- Deliver: non-2xx or throw → retry (5×). Final failure logged with `ok:false`.
- Fanout: no matching subs → no-op. DB error loading subs → job fails and retries.
- Redis down at emit → enqueue throws → swallowed; the app action still succeeds.

## Testing

- `@evo/crypto`: HMAC known-answer test.
- `@evo/webhooks`: `matchingSubs` filtering, `buildDelivery` body shape,
  `signatureHeader` format.
- Worker: fanout enqueues per matching sub; deliver logs ok/failure (mock fetch).
- Existing suites stay green (emit is additive + best-effort).
