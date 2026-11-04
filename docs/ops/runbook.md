# Ops runbook (Plan 0 baseline)

## Local dev

- Start DB+Redis: `docker compose up -d postgres-manager redis-manager`
- Apply migrations: `pnpm --filter @evo/db migrate`
- Run app: `pnpm dev`

## Test DB

The unit tests for `@evo/db` need a separate database. Create once:

```
docker compose exec postgres-manager psql -U manager -c "CREATE DATABASE evolution_manager_test;"
```

## Full stack via compose

`docker compose up -d --build` brings up postgres, redis, web, worker, ingest, caddy. Visit `http://localhost`.

## Resetting

`pnpm --filter @evo/db exec prisma migrate reset --force` drops and recreates the dev DB.

## E2E (Playwright)

Specs live in `tests/e2e/` and drive the real UI. Notes that matter:

- **Export the root `.env` into the shell first** (`set -a; . ./.env; set +a`) — the
  custom Socket.IO server (`apps/web/server.mts`) reads `REDIS_URL` from the process
  env and does not load `.env` itself.
- Specs **reset the local dev DB** (localhost:5433) via `prisma migrate reset`.
- Each instance-dependent spec runs its **own Evolution stub** on a fixed port
  (instance-lifecycle 18080, inbox-roundtrip 18081, broadcast-runs 18082, automation
  18083, bot-action-chain + warmer 18084, inbound-integrations 18085). Point the stack
  at the right stub per spec: `EVOLUTION_BASE_URL=http://localhost:<port>`.
- Ingest must allow unauthenticated webhooks for the specs:
  `WEBHOOK_INBOUND_ALLOW_UNSAFE=true` (and unset `WEBHOOK_INBOUND_SECRET`).
- **Avoid `tsx watch`/`next dev` for E2E on macOS** — the default `maxfiles` soft limit
  (256) makes the watchers die with `EMFILE` and Next silently 404s. Run the
  watcher-free stack instead: `pnpm --filter @evo/web build`, then
  `NODE_ENV=production tsx server.mts` (web), `tsx src/index.ts` (ingest, worker).

## Secrets at rest

Instance API keys (`Instance.evolutionApiKey`) are AES-256-GCM encrypted with
`ENCRYPTION_KEY`, tagged `enc:`. Legacy plaintext rows still work (read path passes
them through); encrypt them once with:

```
pnpm --filter @evo/db exec tsx scripts/encrypt-instance-keys.mts
```

`ENCRYPTION_KEY` must be present in every runtime that talks to Evolution (web,
worker, ingest).

## Test-database safety

All unit/integration test setups FORCE `evolution_manager_test` and refuse to run
against any database whose name lacks `_test` — a sourced `.env` can no longer point
destructive test suites at the dev database. Override only via `TEST_DATABASE_URL`.
