# Next.js Manager for Evolution API — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Replace Evolution API's bundled manager UI and the standalone warmer UI with a single Next.js application that:

1. Matches the existing Evolution manager feature-for-feature.
2. Adds the feature set offered by WasapBot (Malaysian WhatsApp marketing/CRM platform).
3. Folds in the existing local `warmer/` engine as a first-class feature.
4. Ships in English (UK) throughout.
5. Supports multi-tenant workspaces (multiple organisations on one server).

Evolution API itself is **not** modified. It runs unchanged as the WhatsApp gateway behind us.

## Non-goals

- Replacing Evolution API's Express/Baileys core.
- Re-implementing Evolution's built-in integrations (Chatwoot, Typebot, RabbitMQ, etc.). We expose them as pass-through configurators.
- Drop-in API compatibility with the existing Evolution manager's HTTP surface.

## High-level architecture

Approach: independent Next.js application with its own Postgres database, talking to Evolution API over HTTP and receiving Evolution webhooks. A separate Node worker process owns background jobs (broadcasts, drip, warmer, AI). A separate webhook-ingest process owns the public webhook endpoint.

```
                       ┌───────────────────────────────────┐
                       │              Caddy                │
                       │ (auto-TLS reverse proxy)          │
                       └────┬───────────────┬──────────────┘
                            │               │
              /api/whatsapp/webhook/*       │
                            │               │  everything else
                            ▼               ▼
                  ┌────────────────┐  ┌──────────────────┐
                  │ webhook-ingest │  │      web         │
                  │  (Node, :4000) │  │ Next.js + Socket │
                  └───────┬────────┘  │   .IO  (:3000)   │
                          │           └────────┬─────────┘
                          │                    │
                          ▼                    ▼
                       Redis ◄─── pub/sub ────┤
                       BullMQ ◄── jobs ───────┤
                          ▲                    │
                          │                    │
                  ┌───────┴────────┐           │
                  │     worker     │───► Evolution API ◄─── WhatsApp
                  │ BullMQ + cron  │      (unmodified)
                  └────────────────┘
                          │
                          ▼
                     Postgres (manager DB)
                     Postgres (evolution DB — separate)
```

## Stack

- Next.js 15, App Router, TypeScript.
- shadcn/ui + Tailwind.
- Prisma + Postgres (separate database from Evolution's Postgres).
- Auth.js v5 (email + password, magic-link optional).
- BullMQ + Redis (separate Redis from Evolution's).
- Socket.IO server (mounted on a custom Next.js Node server, Redis adapter).
- TanStack Query, React Hook Form, Zod.
- `next-intl` with `en-GB` as the default and only shipped locale in v1.
- AI: Claude (Haiku 4.5 default; Sonnet 4.6 for higher quality) via the Anthropic SDK, with OpenAI as an optional secondary per-workspace provider.
- Caddy as the edge reverse proxy (auto-TLS).
- Docker-compose for orchestration.

## Tenancy model

Multi-tenant. Top-level entity is **Workspace** (one organisation, one billing unit). Almost every row carries `workspaceId`. RBAC enforced at the API route layer via `requireMember(workspaceId, role)` and reinforced by a tenant-scoped Prisma client wrapper that injects `workspaceId` into every query — a forgotten filter fails closed.

Roles: `Owner | Admin | Agent | Viewer`.

## Data model

Manager DB (Prisma; own database).

### Identity

- `User` (email, password hash (argon2id), name, locale).
- `Session` (Auth.js).
- `Workspace` (name, slug, timezone, defaultLocale, planId).
- `WorkspaceMember` (userId, workspaceId, role).
- `Invitation` (workspaceId, email, role, token, expiresAt).

### WhatsApp linkage

- `Instance` (workspaceId, label, evolutionInstanceName, evolutionApiKey, connectionState, lastSeenAt, phoneNumber, profile snapshot JSON).

### Contacts

- `Contact` (workspaceId, phoneE164, name, profilePicUrl, lastSeenAt, customFields JSON).
- `Label` (workspaceId, name, colour).
- `ContactLabel` (m:n).
- `ContactList` (workspaceId, name, filter JSON).
- `ContactListMember`.

### Messaging

- `Conversation` (workspaceId, instanceId, contactId, lastMessageAt, unreadCount, assignedToUserId, status: `open | pending | resolved`).
- `Message` (conversationId, direction, evolutionMessageId, type, body, mediaUrl, status, sentAt, sentByUserId nullable). Cache only — Evolution remains source of truth.

### Broadcasts

- `Broadcast` (workspaceId, instanceId, name, status, scheduledAt, jitterMinMs, jitterMaxMs, createdByUserId).
- `BroadcastTarget` (broadcastId, contactId, status: `queued | sending | sent | delivered | read | failed`, error, sentAt).
- `MessageTemplate` (workspaceId, name, body, buttons JSON, mediaUrl, type).

### Automation

- `Chatbot` (workspaceId, instanceId, enabled, fallbackProvider: `claude | openai | none`, fallbackModel, systemPrompt, apiKeyRef).
- `KeywordTrigger` (chatbotId, keyword, matchType, response).
- `Flow` (workspaceId, name, definition JSON, version) — drag-drop builder.
- `FlowRun` (flowId, contactId, currentNodeId, state JSON).
- `DripCampaign` (workspaceId, name, triggerType, steps JSON).
- `DripEnrolment` (campaignId, contactId, currentStep, nextRunAt).

### Team inbox

- `Assignment` (conversationId, userId, assignedAt).
- `InternalNote` (conversationId, userId, body).
- `QuickReply` (workspaceId, shortcut, body).

### Warmer

- `WarmerProfile` (workspaceId, name, config JSON — pacing, ramp, time-of-day weights, mode, participating instances, outbound partners, media, reactions).
- `WarmerTemplate` (workspaceId, body) — seeded from existing `templates.json`.
- `WarmerPreset` (global, seeded — `balanced | aggressive | conservative`).
- `WarmerRun` (profileId, startedAt, stoppedAt, status).
- `WarmerEvent` (runId, ts, instanceId, kind, detail) — 14-day retention.

### Ops

- `AuditLog` (workspaceId, userId, action, target, diff JSON, ts).
- `ApiKey` (workspaceId, name, hashedKey, scopes, createdByUserId).
- `WebhookSubscription` (workspaceId, url, secret, events[]).

### Billing / limits

- `Plan` (name, contactCap, instanceCap, monthlyMessageCap, featureFlags JSON).
- `WorkspacePlan` (workspaceId, planId, since, until).

### What we deliberately do not store

WhatsApp session blobs, raw Baileys auth state, message media binaries — Evolution and its S3/Minio handle those. We store URLs/references only.

## Screen inventory

App Router routes scoped under `/[workspaceSlug]/...`. ~40 screens total. Locale `en-GB`.

### Auth & onboarding (unscoped)

- `/sign-in`, `/sign-up`, `/forgot-password`, `/accept-invite/[token]`
- `/onboarding` — create first workspace, connect first instance, set timezone

### Workspace shell

- `/dashboard` — KPI tiles, recent activity
- `/instances` — connected numbers, health badges, plan slot usage
- `/instances/new` — create-and-pair (QR or pairing code, live state via Socket.IO)
- `/instances/[id]` — overview, profile (name, picture, status), proxy, restart/logout, settings, danger zone
- `/instances/[id]/webhook` — per-instance webhook URL + secret + event picker
- `/instances/[id]/integrations` — Chatwoot, Typebot, RabbitMQ, SQS, Kafka, Pusher (pass-through configurators)

### Inbox

- `/inbox` — three-pane (filter rail / list / chat), realtime, typing indicators, read receipts, quick replies, internal notes, assign-to, label, resolve
- `/inbox/[conversationId]` — deep link

### Contacts

- `/contacts` — table, filter, bulk actions (label, add to list, export CSV, delete)
- `/contacts/import` — CSV upload + column mapping + number-existence check
- `/contacts/[id]` — full profile
- `/labels` — CRUD
- `/lists` — saved segments

### Broadcasts

- `/broadcasts` — list with status, schedule, progress, owner
- `/broadcasts/new` — wizard (audience → template → schedule + jitter → preview → confirm)
- `/broadcasts/[id]` — live progress, per-target status, retry failed, pause/resume, analytics
- `/templates` — message templates (text + media + button/list)

### Automation

- `/automation/chatbot` — per-instance: welcome, keyword triggers, AI fallback
- `/automation/flows` — drag-drop flow list
- `/automation/flows/[id]` — React Flow editor (trigger / condition / message / wait / AI / branch / set-label / assign-agent)
- `/automation/drip` — drip campaigns
- `/automation/drip/[id]` — step editor + audience trigger + enrolment list

### Warmer

- `/warmer` — profile list, run state, last-24h sparkline
- `/warmer/new` — profile editor (instances, outbound partners, schedule, ramp, pacing, weights, media, reactions, preset picker)
- `/warmer/[id]` — live log (Socket.IO), stats, edit, start/stop

### Analytics

- `/analytics/messages` — volume by day / instance / direction
- `/analytics/broadcasts` — funnel + cohort
- `/analytics/agents` — response time, resolution rate
- `/analytics/warmer` — per-instance warming progress

### Settings

- `/settings/profile` — name, password, locale, notifications
- `/settings/workspace` — name, timezone, default locale, branding
- `/settings/members` — invite, roles, remove
- `/settings/api-keys` — developer API keys + scopes
- `/settings/webhooks` — workspace-level outbound webhooks
- `/settings/integrations` — Make.com, Pabbly, Zapier, WooCommerce, Shopify, Google Sheets, AI providers (Claude/OpenAI keys)
- `/settings/plan` — plan, usage meters
- `/settings/audit` — audit log table

### System admin (super-admin only, unscoped)

- `/admin/workspaces`, `/admin/users`, `/admin/plans`, `/admin/health`

## Queue & realtime topology

### Processes

Four long-lived processes in production:

1. **`web`** — Next.js custom Node server (App Router + Socket.IO server, Redis adapter).
2. **`worker`** — pure Node, BullMQ workers + cron, `/healthz` only.
3. **`ingest`** — public webhook endpoint Evolution POSTs to. Verifies HMAC against `Instance.evolutionApiKey`, normalises payload, writes to DB inside a transaction, enqueues jobs, publishes to Redis pub/sub. Separated so a bad `web` deploy never drops webhooks.
4. **`evolution-api`** — upstream container, unmodified.

Plus Postgres × 2 and Redis × 2 (separate instances for manager vs. Evolution in both dev and prod).

### BullMQ queues

- `broadcast-scheduler` — repeatable (every 30s), enqueues next slice of targets.
- `broadcast-send` — sends one message per job. Per-instance bucket.
- `drip-tick` — repeatable (every minute), advances enrolments.
- `flow-tick` — wait-node timers for the flow builder.
- `webhook-out` — outbound webhook delivery with exponential backoff.
- `warmer-tick` — drives warmer engine, picks the next pair, schedules turns.
- `warmer-send` — sends one warmer turn (presence → message). Per-instance bucket.
- `ai-reply` — generates a Claude/OpenAI reply when chatbot fallback fires.
- `contact-validate` — number-existence check via Evolution `chat/whatsappNumbers`.
- `media-fetch` — downloads Evolution-stored media for inbox previews.

### Per-instance token bucket

One Redis-backed leaky bucket per `instanceId`, replenishing at the plan's `maxSendsPerMinute`. Every queue that emits a WhatsApp message takes from the same bucket. Single chokepoint preventing over-send. A running warmer correctly throttles a broadcast on the same number (confirmed design choice).

### Realtime fan-out (Socket.IO)

Server runs on `web` with the Redis adapter. Rooms:

- `ws:{workspaceId}` — workspace-wide (broadcast progress, instance state, audit).
- `ws:{workspaceId}:conv:{conversationId}` — inbox per-conversation.
- `ws:{workspaceId}:instance:{instanceId}` — QR, connection state, warmer logs.

Auth on connect: Auth.js session → membership lookup → joined rooms.

`ingest` publishes to Redis pub/sub `events:{workspaceId}`; `web` subscribes and forwards to the matching Socket.IO room.

### Webhook ingest hot path

```
Evolution → POST /whatsapp/webhook/{workspaceId}/{instanceId}
         → ingest verifies HMAC against Instance.evolutionApiKey
         → normalise payload
         → Postgres tx: upsert Contact, upsert Conversation, insert Message
         → publish events:{workspaceId}
         → enqueue chatbot / flow / webhook-out jobs as needed
         → 200 OK (target p95 < 100 ms)
```

If the DB write fails we 5xx so Evolution retries.

### Failure model

- Every queue: 3 retries, exponential backoff with jitter. Dead jobs → `failed-jobs` queue surfaced in `/admin/health`.
- Broadcast `failed` targets individually retryable from the UI.
- Webhook-out subscriptions auto-disabled after N consecutive failures.

## Evolution API integration surface

A thin typed client in `packages/evolution-client/`. Every call carries the `apikey` header (per-instance key on `Instance.evolutionApiKey`). Only `worker`, `ingest`, and `web` import it — the browser never calls Evolution directly.

### Endpoints consumed

Instance lifecycle: `/instance/create`, `/instance/connect`, `/instance/connectionState`, `/instance/logout`, `/instance/delete`, `/instance/restart`, `/instance/setPresence`.

Settings & profile: `/settings/{set,find}`, `/chat/updateProfile{Name,Status,Picture}`, `/chat/removeProfilePicture`, `/chat/fetchProfile`, `/chat/fetchBusinessProfile`, `/proxy/{set,find}`.

Sending: `/message/{sendText,sendMedia,sendAudio,sendButton,sendList,sendPoll,sendLocation,sendContact,sendReaction,sendSticker}`, `/chat/sendPresence`, `/chat/markMessageAsRead`, `/chat/deleteMessageForEveryone`.

Reads (lazy + cached): `/chat/findMessages`, `/chat/findContacts`, `/chat/findChats`, `/chat/whatsappNumbers` (number validator), `/chat/getBase64FromMediaMessage`.

Groups: `/group/{create,updateGroupPicture,updateGroupSubject,updateGroupDescription,updateParticipant,fetchAllGroups,findParticipants,inviteCode,revokeInviteCode,sendInvite,leaveGroup}`.

Webhook config (we own this — the manager configures Evolution to point at `ingest`): `/webhook/{set,find}`.

Pass-through configurators (forms write to Evolution; runtime stays in Evolution): `/chatwoot/set`, `/rabbitmq/set`, `/kafka/set`, `/sqs/set`, `/pusher/set`, `/typebot/create`, `/openai/creds`, etc.

### Webhook events ingested

`MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `MESSAGES_DELETE`, `SEND_MESSAGE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `CONTACTS_UPSERT`, `CONTACTS_UPDATE`, `CHATS_UPSERT`, `CHATS_UPDATE`, `CHATS_DELETE`, `GROUPS_UPSERT`, `GROUP_PARTICIPANTS_UPDATE`, `PRESENCE_UPDATE`, `LABELS_EDIT`, `LABELS_ASSOCIATION`.

Ignored: `TYPEBOT_*`, `CHATWOOT_*` (Evolution handles those internally).

### Anti-ban pacing

Every outbound send routes through one helper `sendViaInstance(instanceId, payload)`:

1. Take a token from the per-instance bucket (wait up to 5 min).
2. Emit `presence=composing` for `min(len * typingPerCharMs, typingMaxMs)`.
3. Call Evolution.
4. On 429/timeout, exponential backoff with jitter.
5. Write `AuditLog`, emit `ws:{workspaceId}` event.

This is the only sanctioned WhatsApp-send path in the codebase. Single audit point. Single throttle point.

### Sync & cache strategy

- First-connect: one-time backfill job pulls last N days via `findContacts` / `findChats` / `findMessages`, persists into the cache. Progress bar in `/instances/[id]`.
- After that: webhook is the source of truth. Evolution is only called for explicit user actions and on cache miss.
- Cache miss when opening an old conversation: lazy-fetch `findMessages`, persist.

## Warmer port

The existing standalone `warmer/` folds into the new app.

### Behaviour preserved from `engine.js` / `config.json`

- Ramp curve (`day0` → `day14` → `day30` interpolated sends/day).
- Time-of-day weights (24-element array).
- Day-of-week weights (7-element array).
- Pacing (`typingPerCharMs`, `typingMinMs`, `typingMaxMs`, `replyMinMs`, `replyMaxMs`, `conversationGapMinMs/Max`, `minTurnsPerConversation`, `maxTurnsPerConversation`).
- Schedule window (`startHour..endHour`, `skipProbability`).
- Media injection (image URL list).
- Reactions (emoji list).
- Health-check loop (`healthCheck.intervalSec`).
- Context awareness (`contextAware`) — engine picks a coherent template thread per conversation turn.
- Presets (`PRESET_BLUEPRINTS`) seeded as global `WarmerPreset` rows.

### What changes

| Today | New |
|---|---|
| Global `config.json` | `WarmerProfile.config` row per workspace |
| `state.json` on disk | Postgres (`WarmerRun`, `WarmerEvent`) + Redis counters |
| `templates.json` flat file | `WarmerTemplate` rows (seeded with existing English UK set) |
| `engine.js` long-running loop | `warmer-tick` repeatable job picks the next move; `warmer-send` sends |
| SSE log at `/api/log` | Socket.IO room `ws:{workspaceId}:warmer:{profileId}` |
| `/webhook` listener | Shared `ingest` already receives `MESSAGES_UPSERT`; warmer runs subscribe to relevant events |
| `apiKey` config-wide | Each `Instance` has its own `evolutionApiKey` |

### Pair model

- `WarmerProfile.participatingInstanceIds[]` — workspace's own instances.
- `WarmerProfile.outboundPartners[]` — `{ number, label }` external numbers.
- Mode `"internal"` (default when ≥3 participating instances): instances chat each other (WasapBot "Converse" mode). On by default with a toggle.
- Mode `"pair"`: each instance picks a random outbound partner.
- Shared per-instance token bucket applies — warmer cannot starve broadcasts.

### Warmer guardrails

- Bucket check fails closed against plan `monthlyMessageCap`.
- Run pauses if any participant's `connectionState` drops.
- `WarmerEvent` retention 14 days; daily `warmer-summary` job rolls up to per-day counts.

### CLI

`warmer.js` CLI is dropped. CLI access is available via the developer API.

### Migration

One-shot import script (`scripts/import-warmer.ts`) reads existing `warmer/config.json` and `warmer/templates.json` on first install and seeds a `WarmerProfile` per workspace. Standalone `warmer/` is then decommissioned.

## Deployment & ops

### Repository layout

```
/
├─ apps/
│  ├─ web/              Next.js 15 + Socket.IO custom server
│  ├─ worker/           BullMQ + cron
│  └─ ingest/           webhook-ingest HTTP service
├─ packages/
│  ├─ db/               Prisma schema + client
│  ├─ evolution-client/ typed Evolution REST wrapper
│  ├─ shared/           zod schemas, types, error classes
│  ├─ ai/               Claude/OpenAI provider abstraction
│  └─ ui/               shadcn-derived shared components
├─ evolution-api/       upstream image (runs via compose)
├─ docker-compose.yml
├─ docker-compose.prod.yml
└─ docs/superpowers/
```

pnpm workspaces.

### docker-compose services

`postgres-manager`, `postgres-evolution`, `redis-manager`, `redis-evolution`, `evolution-api`, `web`, `worker`, `ingest`, `caddy`.

Evolution and manager run separate Postgres and Redis instances in both dev and prod (confirmed design choice).

### Reverse proxy

Caddy at the edge, auto-TLS via Let's Encrypt. Routes `/api/whatsapp/webhook/*` → `ingest`, everything else → `web`.

### Environment variables (curated)

- `DATABASE_URL`, `REDIS_URL` (manager).
- `EVOLUTION_BASE_URL`, `EVOLUTION_GLOBAL_API_KEY` (used only to bootstrap new instance keys).
- `WEBHOOK_PUBLIC_BASE_URL` (what we tell Evolution to POST to).
- `AUTH_SECRET`, `AUTH_URL`.
- `DEFAULT_LOCALE=en-GB`, `DEFAULT_TIMEZONE=Asia/Kuala_Lumpur`.
- `S3_*` (optional).
- `AI_DEFAULT_PROVIDER=claude`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (workspace-scoped overrides in DB).
- `PLAN_ENFORCE=true|false`.
- `LOG_LEVEL`, `SENTRY_DSN`.

### Locale (English UK)

- `next-intl` with `en-GB` as the only v1 locale.
- All copy in `apps/web/messages/en-GB.json` (grep-friendly).
- DD/MM/YYYY, 24-hour clock, "colour" / "organise" / "behaviour" / "mobile".
- `Intl.DateTimeFormat('en-GB', { timeZone: workspace.timezone })`. UTC in DB.
- Phone numbers E.164.

### Observability

- pino JSON logs, correlation id propagated `ingest` → queue → outbound.
- Prometheus `/metrics` on every app. Counters for queue depth, send latency, ingest latency, Evolution error rate, per-instance bucket utilisation. Grafana JSON committed.
- OpenTelemetry tracing (optional, off by default).
- Sentry (optional).
- `/healthz` per app. `/admin/health` UI shows queue depth, dead jobs, instance pool, last webhook ts per instance.

### Backups

- Postgres × 2: nightly `pg_dump` to S3, 30-day retention.
- Redis: BullMQ persistence non-critical (jobs re-derivable from DB).
- Evolution session blobs: Evolution's responsibility (runbook documented).

### Migrations

- `pnpm db:migrate` runs Prisma `migrate deploy` on `web` boot, guarded by an advisory lock so replicas don't race.
- `worker` waits on a migration-complete flag in Redis before starting.

### Security

- Caddy auto-TLS outbound HTTPS.
- Inbound webhook HMAC against `Instance.evolutionApiKey`.
- Tenancy guard on every Prisma call.
- argon2id passwords. Rotating httpOnly sameSite=lax session cookies.
- Per-workspace rate limits (login, broadcast creation, AI calls).
- CSP and security headers via Caddy.
- Audit log: instance create/delete, broadcast create/send, member add/remove/role change, plan change, API key issuance, webhook subscription change.

### CI/CD

GitHub Actions: lint, typecheck, vitest unit tests, integration tests against ephemeral Postgres + Redis, Playwright e2e for happy-path screens, build images, push to GHCR. One workflow per app's Dockerfile.

### Dev experience

- `pnpm dev` runs all four apps + postgres × 2 + redis × 2 + evolution-api via compose.
- `pnpm seed` creates a demo workspace with sample contacts, a fake instance, and a couple of broadcasts.

## Confirmed design decisions

- Approach 1 (independent manager with own database).
- Multi-tenant workspaces.
- Separate `ingest` process.
- Single per-instance token bucket shared across broadcast / warmer / drip / AI.
- Separate Postgres and Redis for Evolution vs. manager in **both** dev and prod.
- Caddy auto-TLS.
- Docker-compose for orchestration.
- Drop the warmer CLI.
- Default "Converse" mode on when ≥3 instances.
- AI default provider: Claude.

## Open items (deferred, not blocking)

- Specific plan tiers and their caps (decide at billing milestone).
- Whether to expose the AI provider abstraction to bring-your-own-model (Ollama, etc.) — defer to post-v1.
- k8s manifests — defer until self-hoster demand surfaces.
