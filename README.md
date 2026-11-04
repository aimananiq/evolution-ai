# Evolution Manager

Next.js manager UI for Evolution API. Multi-tenant. English (UK). Built to replace Evolution's bundled manager + the standalone warmer with one application.

## Stack

Next.js 15, Prisma + Postgres, Auth.js v5, BullMQ + Redis, Socket.IO, next-intl (en-GB), shadcn/ui + Tailwind. Docker-compose for orchestration. Caddy at the edge.

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres-manager redis-manager
pnpm install
pnpm --filter @evo/db migrate
pnpm dev
```

Open `http://localhost:3000`. Sign up, create a workspace, you're in.

## Layout

- `apps/web` — Next.js app
- `apps/worker` — BullMQ workers + cron (skeleton; jobs added in later plans)
- `apps/ingest` — Evolution webhook receiver (skeleton; full pipeline in Plan 2)
- `packages/db` — Prisma schema + tenant-scoped client
- `packages/shared` — shared types, errors, helpers

## Specs and plans

- Spec: `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md`
- Plans: `docs/superpowers/plans/`

## Tests

- `pnpm test` — unit tests across packages
- `pnpm --filter @evo/web test:e2e` — Playwright happy-path
