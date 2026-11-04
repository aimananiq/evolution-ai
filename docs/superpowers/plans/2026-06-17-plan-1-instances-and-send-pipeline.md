# Plan 1 — Instances + send pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the manager to a running Evolution API so a user can create a WhatsApp instance, scan its QR code, see connection state, and send a test message — all routed through a single per-instance Redis token bucket with an audit trail.

**Architecture:** Add Evolution API + its own Postgres + Redis to the docker-compose. Introduce a typed `@evo/evolution-client` wrapper around Evolution's REST API. Add `Instance` and `AuditLog` tables. Build `@evo/queue` with BullMQ + a Redis-backed per-instance token bucket. Every outbound send routes through one `sendViaInstance(instanceId, payload)` helper that takes a token, sends a typing indicator, calls Evolution, writes audit, and bubbles errors typed. UI gets the instance list, create-and-pair wizard, detail page, and a send-test panel.

**Tech Stack:** Inherits Plan 0 (Next.js 15, Prisma 6, Postgres 16, Redis 7, Auth.js v5, next-intl en-GB, Vitest, Playwright). Adds: `bullmq ^5.x`, `ioredis ^5.x`, `qrcode ^1.5.x` (server-render QR images), `evolution-api` upstream container.

**Definition of done:**
1. `docker compose up` brings up Evolution API alongside the manager stack with separate postgres and redis.
2. From the manager UI, an admin can create an instance, view its QR pairing code, scan it with a real WhatsApp account, see the connection state flip to `open`.
3. A signed-in admin can hit a "Send test message" form, the message arrives at the target number, the broadcast is rate-limited by the per-instance bucket, and an `AuditLog` row records the send.
4. Tenancy isolation holds: instances created in workspace A are invisible to workspace B (verified by a unit test).
5. All previous tests still pass; new tests added: `@evo/evolution-client` 6+, `@evo/queue` 4+, instances-route 3+, send-helper 3+.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — sections 1 (data model: WhatsApp linkage), 3 (queue/realtime — `broadcast-send`/token bucket parts), 4 (Evolution integration surface), 6 (deployment — Evolution container).

---

## File structure produced by this plan

```
/
├─ docker-compose.yml                              # MODIFIED: add evolution-api + own pg/redis
├─ .env.example                                    # MODIFIED: add EVOLUTION_* keys
├─ packages/
│  ├─ db/
│  │  ├─ prisma/schema.prisma                      # MODIFIED: add Instance, AuditLog
│  │  └─ prisma/migrations/<ts>_instances_audit/   # NEW migration
│  ├─ evolution-client/                            # NEW package
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ index.ts
│  │     ├─ client.ts                              # base client with apikey + base URL
│  │     ├─ errors.ts                              # EvolutionError + subclasses
│  │     ├─ instance.ts                            # create / connect / connectionState / delete / restart
│  │     ├─ message.ts                             # sendText (Plan 1 scope) + sendPresence
│  │     ├─ webhook.ts                             # set / find
│  │     ├─ types.ts                               # zod schemas + inferred types
│  │     ├─ client.test.ts
│  │     ├─ instance.test.ts
│  │     └─ message.test.ts
│  └─ queue/                                       # NEW package
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts
│        ├─ redis.ts                               # ioredis singleton
│        ├─ bucket.ts                              # tokenBucket(instanceId)
│        ├─ bucket.test.ts
│        └─ types.ts
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ lib/
│  │  │  │  ├─ audit.ts                            # writeAudit({ workspaceId, userId, action, target, diff })
│  │  │  │  ├─ audit.test.ts
│  │  │  │  ├─ send.ts                             # sendViaInstance(instanceId, payload)
│  │  │  │  └─ send.test.ts
│  │  │  └─ app/
│  │  │     ├─ api/workspaces/[slug]/instances/
│  │  │     │  ├─ route.ts                         # GET list, POST create
│  │  │     │  └─ [id]/
│  │  │     │     ├─ route.ts                      # GET detail, DELETE
│  │  │     │     ├─ qr/route.ts                   # GET current QR or pairing code
│  │  │     │     ├─ state/route.ts                # GET connectionState (polled by UI)
│  │  │     │     └─ send-test/route.ts            # POST { to, body }
│  │  │     └─ [workspaceSlug]/
│  │  │        └─ instances/
│  │  │           ├─ page.tsx                      # list
│  │  │           ├─ new/page.tsx                  # create-and-pair wizard
│  │  │           ├─ [id]/page.tsx                 # detail (overview, danger zone)
│  │  │           ├─ [id]/pair/page.tsx            # QR display + state polling
│  │  │           └─ [id]/test-send/page.tsx       # send-test form
│  │  └─ messages/en-GB.json                       # MODIFIED: instances.*, audit.*
│  └─ worker/
│     └─ src/index.ts                              # MODIFIED: stub a no-op `instance-state-tick` job repeater
└─ tests/e2e/
   └─ instance-lifecycle.spec.ts                   # NEW: create instance → QR rendered → delete
```

Tasks below build this in order.

---

### Task 1: Add Evolution API to docker-compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Add evolution-postgres + evolution-redis + evolution-api services**

Replace the existing `docker-compose.yml` with the following (the manager-side services are unchanged; the Evolution-side services and `caddy.depends_on` are added):

```yaml
name: evolution-manager
services:
  postgres-manager:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: manager
      POSTGRES_PASSWORD: manager
      POSTGRES_DB: evolution_manager
    ports: ["5433:5432"]
    volumes: [postgres-manager-data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U manager"]
      interval: 5s
      retries: 10

  redis-manager:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis-manager-data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  postgres-evolution:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: evolution
      POSTGRES_DB: evolution
    ports: ["5434:5432"]
    volumes: [postgres-evolution-data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution"]
      interval: 5s
      retries: 10

  redis-evolution:
    image: redis:7-alpine
    ports: ["6380:6379"]
    volumes: [redis-evolution-data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  evolution-api:
    image: atendai/evolution-api:v2.3.7
    environment:
      SERVER_TYPE: http
      SERVER_PORT: 8080
      CORS_ORIGIN: "*"
      AUTHENTICATION_TYPE: apikey
      AUTHENTICATION_API_KEY: ${EVOLUTION_GLOBAL_API_KEY}
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:evolution@postgres-evolution:5432/evolution?schema=public
      DATABASE_CONNECTION_CLIENT_NAME: evolution_exchange
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis-evolution:6379/0
      CACHE_REDIS_PREFIX_KEY: evolution
      CACHE_LOCAL_ENABLED: "false"
      LOG_LEVEL: ERROR,WARN,INFO
      DEL_INSTANCE: "false"
      QRCODE_LIMIT: 30
      WEBHOOK_GLOBAL_ENABLED: "false"
    depends_on:
      postgres-evolution: { condition: service_healthy }
      redis-evolution: { condition: service_healthy }
    ports: ["8080:8080"]
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080 >/dev/null 2>&1 || exit 1"]
      interval: 10s
      retries: 10

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      DATABASE_URL: postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public
      REDIS_URL: redis://redis-manager:6379/0
      EVOLUTION_BASE_URL: http://evolution-api:8080
      EVOLUTION_GLOBAL_API_KEY: ${EVOLUTION_GLOBAL_API_KEY}
      WEBHOOK_PUBLIC_BASE_URL: ${WEBHOOK_PUBLIC_BASE_URL}
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: ${AUTH_URL}
      DEFAULT_LOCALE: en-GB
    depends_on:
      postgres-manager: { condition: service_healthy }
      redis-manager: { condition: service_healthy }
      evolution-api: { condition: service_healthy }
    ports: ["3000:3000"]

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      DATABASE_URL: postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public
      REDIS_URL: redis://redis-manager:6379/0
      EVOLUTION_BASE_URL: http://evolution-api:8080
    depends_on:
      postgres-manager: { condition: service_healthy }
      redis-manager: { condition: service_healthy }

  ingest:
    build: { context: ., dockerfile: apps/ingest/Dockerfile }
    environment:
      DATABASE_URL: postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public
      REDIS_URL: redis://redis-manager:6379/0
    depends_on:
      postgres-manager: { condition: service_healthy }
      redis-manager: { condition: service_healthy }
    ports: ["4000:4000"]

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [web, ingest]

volumes:
  postgres-manager-data:
  redis-manager-data:
  postgres-evolution-data:
  redis-evolution-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 2: Update `.env.example`**

Append these lines to `.env.example` (or update existing values to non-placeholder defaults):

```bash
EVOLUTION_BASE_URL="http://localhost:8080"
EVOLUTION_GLOBAL_API_KEY="dev-evolution-key-change-me"
WEBHOOK_PUBLIC_BASE_URL="http://localhost:4000"
```

Also update local `.env` to mirror those values (do NOT commit `.env`).

- [ ] **Step 3: Validate compose and bring up Evolution stack**

```bash
docker compose config > /dev/null && echo "compose ok"
docker compose up -d postgres-evolution redis-evolution
sleep 5
docker compose up -d evolution-api
# Wait until evolution-api healthy
until docker compose ps evolution-api --format json | grep -q '"Health":"healthy"'; do sleep 3; done
curl -s -H "apikey: dev-evolution-key-change-me" http://localhost:8080/instance/fetchInstances | head -c 200
```

Expected: a JSON response (likely an empty array `[]`) from Evolution's `fetchInstances` endpoint.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(infra): add Evolution API + its own postgres/redis to compose"
```

---

### Task 2: Add `Instance` and `AuditLog` tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- New: `packages/db/prisma/migrations/<ts>_instances_audit/migration.sql`
- Modify: `packages/db/src/tenant.ts` (add `Instance` and `AuditLog` to `TENANTED_MODELS`)

- [ ] **Step 1: Append models to schema.prisma**

After the existing `Invitation` model in `packages/db/prisma/schema.prisma`, append:

```prisma
enum InstanceConnectionState {
  unknown
  connecting
  open
  close
}

model Instance {
  id                   String                  @id @default(cuid())
  workspaceId          String
  label                String
  evolutionInstanceName String                 @unique
  evolutionApiKey      String
  connectionState      InstanceConnectionState @default(unknown)
  phoneNumber          String?
  profileName          String?
  profilePictureUrl    String?
  lastSeenAt           DateTime?
  createdAt            DateTime                @default(now())
  updatedAt            DateTime                @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  auditLogs AuditLog[]

  @@index([workspaceId])
}

model AuditLog {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String?
  instanceId  String?
  action      String
  target      String
  diff        Json?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance? @relation(fields: [instanceId], references: [id], onDelete: SetNull)

  @@index([workspaceId, createdAt])
  @@index([instanceId])
}
```

Then in the existing `Workspace` model, add the back-relations to the relations block:

```prisma
  instances   Instance[]
  auditLogs   AuditLog[]
```

- [ ] **Step 2: Generate migration via Docker-attached Prisma**

Because the host's Postgres on port 5432 is the Homebrew install, Prisma migrate must reach the docker Postgres on 5433 (which it does via the `.env` `DATABASE_URL`). From the repo root:

```bash
pnpm --filter @evo/db exec prisma migrate dev --name instances_audit
```

If the command fails because of a host Postgres conflict on 5432, run instead from inside a temporary node container on the compose network (same workaround as Plan 0 Task 3 fix):

```bash
docker run --rm --network evolution-manager_default \
  -v "$PWD:/app" -w /app -e DATABASE_URL="postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public" \
  node:20-alpine sh -c "corepack enable && pnpm --filter @evo/db exec prisma migrate dev --name instances_audit"
```

The generated directory should be `packages/db/prisma/migrations/<14-digit-timestamp>_instances_audit/` with a `migration.sql`.

- [ ] **Step 3: Extend `tenantClient` to scope new models**

`packages/db/src/tenant.ts` — modify the `TENANTED_MODELS` set:

```typescript
const TENANTED_MODELS = new Set<string>([
  "Workspace",
  "WorkspaceMember",
  "Invitation",
  "Instance",
  "AuditLog",
]);
```

No other change to `tenant.ts`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @evo/db generate
pnpm --filter @evo/db test
```

Existing 3 tenant tests must still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add Instance and AuditLog tables; extend tenant scope"
```

---

### Task 3: `@evo/queue` package — Redis + token bucket (TDD)

**Files:**
- Create: `packages/queue/package.json`
- Create: `packages/queue/tsconfig.json`
- Create: `packages/queue/src/redis.ts`
- Create: `packages/queue/src/bucket.ts`
- Test: `packages/queue/src/bucket.test.ts`
- Create: `packages/queue/src/types.ts`
- Create: `packages/queue/src/index.ts`

- [ ] **Step 1: package.json + tsconfig**

`packages/queue/package.json`:

```json
{
  "name": "@evo/queue",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "bullmq": "^5.30.0",
    "ioredis": "^5.4.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

`packages/queue/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: `src/redis.ts` — singleton ioredis client**

```typescript
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function redis(): Redis {
  if (globalForRedis.redis) return globalForRedis.redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  const client = new Redis(url, { maxRetriesPerRequest: null });
  if (process.env.NODE_ENV !== "production") globalForRedis.redis = client;
  return client;
}
```

- [ ] **Step 3: `src/types.ts`**

```typescript
export interface BucketTakeResult {
  granted: boolean;
  waitedMs: number;
  remaining: number;
}

export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}
```

- [ ] **Step 4: Write failing bucket tests**

`packages/queue/src/bucket.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { redis } from "./redis";
import { tokenBucket } from "./bucket";

const TEST_KEY = "test-instance-" + Date.now();

beforeEach(async () => {
  await redis().del(`bucket:${TEST_KEY}`);
});

describe("tokenBucket", () => {
  it("grants a token when bucket is full", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 5, refillPerSecond: 1 });
    const result = await bucket.take({ waitMs: 0 });
    expect(result.granted).toBe(true);
    expect(result.waitedMs).toBe(0);
    expect(result.remaining).toBe(4);
  });

  it("rejects when waitMs is 0 and bucket is empty", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 1, refillPerSecond: 0.1 });
    const first = await bucket.take({ waitMs: 0 });
    expect(first.granted).toBe(true);
    const second = await bucket.take({ waitMs: 0 });
    expect(second.granted).toBe(false);
  });

  it("waits and grants once refill arrives", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 1, refillPerSecond: 5 });
    await bucket.take({ waitMs: 0 });  // drain
    const start = Date.now();
    const result = await bucket.take({ waitMs: 2000 });
    const elapsed = Date.now() - start;
    expect(result.granted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  }, 5000);

  it("separates buckets by key", async () => {
    const a = tokenBucket(TEST_KEY + "-A", { capacity: 1, refillPerSecond: 0.1 });
    const b = tokenBucket(TEST_KEY + "-B", { capacity: 1, refillPerSecond: 0.1 });
    expect((await a.take({ waitMs: 0 })).granted).toBe(true);
    expect((await b.take({ waitMs: 0 })).granted).toBe(true);
    expect((await a.take({ waitMs: 0 })).granted).toBe(false);
  });
});
```

`packages/queue/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

`packages/queue/src/test-setup.ts`:

```typescript
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = "redis://localhost:6379/15";
}
```

(Logical DB 15 is dedicated to tests so we never collide with the dev DB on 0.)

Run:

```bash
pnpm install
pnpm --filter @evo/queue test
```

Expected: FAIL — module './bucket' not found.

- [ ] **Step 5: Implement `src/bucket.ts`**

Token-bucket via atomic Lua so two clients can't double-consume:

```typescript
import { redis } from "./redis";
import type { BucketConfig, BucketTakeResult } from "./types";

const TAKE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local existing = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(existing[1])
local lastTs = tonumber(existing[2])
if tokens == nil then
  tokens = capacity
  lastTs = nowMs
end
local elapsed = math.max(0, nowMs - lastTs) / 1000
local refill = elapsed * refillPerSecond
tokens = math.min(capacity, tokens + refill)
local granted = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
end
redis.call("HMSET", key, "tokens", tokens, "ts", nowMs)
redis.call("PEXPIRE", key, 3600000)
return {granted, tostring(tokens)}
`;

export interface TokenBucket {
  take(opts: { waitMs: number }): Promise<BucketTakeResult>;
}

export function tokenBucket(instanceKey: string, cfg: BucketConfig): TokenBucket {
  const redisKey = `bucket:${instanceKey}`;
  return {
    async take({ waitMs }: { waitMs: number }): Promise<BucketTakeResult> {
      const startedAt = Date.now();
      const deadline = startedAt + waitMs;
      while (true) {
        const result = (await redis().eval(
          TAKE_SCRIPT,
          1,
          redisKey,
          cfg.capacity.toString(),
          cfg.refillPerSecond.toString(),
          Date.now().toString(),
        )) as [number, string];
        const [granted, remainingStr] = result;
        const remaining = Number(remainingStr);
        if (granted === 1) {
          return { granted: true, waitedMs: Date.now() - startedAt, remaining };
        }
        if (Date.now() >= deadline) {
          return { granted: false, waitedMs: Date.now() - startedAt, remaining };
        }
        const msUntilNext = Math.max(50, Math.ceil(1000 / cfg.refillPerSecond));
        const sleepFor = Math.min(msUntilNext, Math.max(50, deadline - Date.now()));
        await new Promise((r) => setTimeout(r, sleepFor));
      }
    },
  };
}
```

- [ ] **Step 6: `src/index.ts`**

```typescript
export { redis } from "./redis";
export { tokenBucket, type TokenBucket } from "./bucket";
export type { BucketConfig, BucketTakeResult } from "./types";
```

- [ ] **Step 7: Run tests**

```bash
docker compose up -d redis-manager
pnpm --filter @evo/queue test
```

Expected: 4/4 passing.

- [ ] **Step 8: Commit**

```bash
git add packages/queue pnpm-lock.yaml
git commit -m "feat(queue): @evo/queue with ioredis singleton + Redis-backed token bucket"
```

---

### Task 4: `@evo/evolution-client` package — base client + errors (TDD)

**Files:**
- Create: `packages/evolution-client/package.json`
- Create: `packages/evolution-client/tsconfig.json`
- Create: `packages/evolution-client/src/errors.ts`
- Create: `packages/evolution-client/src/client.ts`
- Test: `packages/evolution-client/src/client.test.ts`
- Create: `packages/evolution-client/src/index.ts`

- [ ] **Step 1: package.json + tsconfig**

`packages/evolution-client/package.json`:

```json
{
  "name": "@evo/evolution-client",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

`packages/evolution-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: `src/errors.ts`**

```typescript
export class EvolutionError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, opts: { status: number; body?: unknown }) {
    super(message);
    this.status = opts.status;
    this.body = opts.body;
  }
}

export class EvolutionAuthError extends EvolutionError {}
export class EvolutionNotFoundError extends EvolutionError {}
export class EvolutionRateLimitError extends EvolutionError {}
```

- [ ] **Step 3: Failing test for `client.ts`**

`packages/evolution-client/src/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { EvolutionAuthError, EvolutionNotFoundError, EvolutionRateLimitError, EvolutionError } from "./errors";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("EvolutionClient.request", () => {
  it("sends apikey header and JSON body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await c.request("POST", "/path", { hello: "world" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://evo/path");
    expect(init.method).toBe("POST");
    expect(init.headers["apikey"]).toBe("K");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("returns parsed JSON on 200", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    const result = await c.request("GET", "/x");
    expect(result).toEqual({ id: 1 });
  });

  it("throws EvolutionAuthError on 401/403", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionAuthError);
  });

  it("throws EvolutionNotFoundError on 404", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionNotFoundError);
  });

  it("throws EvolutionRateLimitError on 429", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionRateLimitError);
  });

  it("throws generic EvolutionError on 500", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    const err = await c.request("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(EvolutionError);
    expect(err.status).toBe(500);
  });
});
```

- [ ] **Step 4: Run, verify fail**

```bash
pnpm install
pnpm --filter @evo/evolution-client test
```

Expected: FAIL — module './client' not found.

- [ ] **Step 5: Implement `src/client.ts`**

```typescript
import { EvolutionAuthError, EvolutionError, EvolutionNotFoundError, EvolutionRateLimitError } from "./errors";

export interface EvolutionClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: EvolutionClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit & { headers: Record<string, string> } = {
      method,
      headers: { apikey: this.apiKey, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403) {
      throw new EvolutionAuthError(`Evolution auth ${res.status}`, { status: res.status, body: await safeJson(res) });
    }
    if (res.status === 404) {
      throw new EvolutionNotFoundError(`Evolution 404 ${path}`, { status: 404, body: await safeJson(res) });
    }
    if (res.status === 429) {
      throw new EvolutionRateLimitError("Evolution 429", { status: 429, body: await safeJson(res) });
    }
    if (!res.ok) {
      throw new EvolutionError(`Evolution ${res.status} ${path}`, { status: res.status, body: await safeText(res) });
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : ({} as T)) as T;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.clone().json(); } catch { return undefined; }
}
async function safeText(res: Response): Promise<unknown> {
  try { return await res.clone().text(); } catch { return undefined; }
}
```

- [ ] **Step 6: `src/index.ts` (initial)**

```typescript
export { EvolutionClient, type EvolutionClientOptions } from "./client";
export * from "./errors";
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @evo/evolution-client test
```

Expected: 6/6 passing.

- [ ] **Step 8: Commit**

```bash
git add packages/evolution-client pnpm-lock.yaml
git commit -m "feat(evolution-client): base client with typed error mapping"
```

---

### Task 5: `@evo/evolution-client` — instance + message endpoints

**Files:**
- Create: `packages/evolution-client/src/types.ts`
- Create: `packages/evolution-client/src/instance.ts`
- Test: `packages/evolution-client/src/instance.test.ts`
- Create: `packages/evolution-client/src/message.ts`
- Test: `packages/evolution-client/src/message.test.ts`
- Modify: `packages/evolution-client/src/index.ts`

- [ ] **Step 1: `src/types.ts` — zod schemas**

```typescript
import { z } from "zod";

export const ConnectionStateSchema = z.enum(["unknown", "connecting", "open", "close"]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const CreateInstanceInputSchema = z.object({
  instanceName: z.string().min(1),
  qrcode: z.boolean().optional().default(true),
  integration: z.literal("WHATSAPP-BAILEYS").optional().default("WHATSAPP-BAILEYS"),
});
export type CreateInstanceInput = z.infer<typeof CreateInstanceInputSchema>;

export const CreatedInstanceSchema = z.object({
  instance: z.object({ instanceName: z.string(), instanceId: z.string().optional() }),
  hash: z.string().optional(),
  qrcode: z.object({ base64: z.string().optional(), code: z.string().optional() }).optional(),
});
export type CreatedInstance = z.infer<typeof CreatedInstanceSchema>;

export const ConnectResponseSchema = z.object({
  base64: z.string().optional(),
  code: z.string().optional(),
  pairingCode: z.string().optional(),
});
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>;

export const ConnectionStateResponseSchema = z.object({
  instance: z.object({ instanceName: z.string(), state: ConnectionStateSchema }),
});
export type ConnectionStateResponse = z.infer<typeof ConnectionStateResponseSchema>;

export const SendTextInputSchema = z.object({
  number: z.string().min(1),
  text: z.string().min(1),
});
export type SendTextInput = z.infer<typeof SendTextInputSchema>;

export const SendResultSchema = z.object({
  key: z.object({ id: z.string() }).passthrough(),
  status: z.string().optional(),
}).passthrough();
export type SendResult = z.infer<typeof SendResultSchema>;
```

- [ ] **Step 2: `src/instance.ts` — typed methods, uses `EvolutionClient`**

```typescript
import type { EvolutionClient } from "./client";
import {
  ConnectionStateResponseSchema,
  ConnectResponseSchema,
  CreateInstanceInputSchema,
  CreatedInstanceSchema,
  type ConnectionState,
  type ConnectResponse,
  type CreateInstanceInput,
  type CreatedInstance,
} from "./types";

export class InstanceApi {
  constructor(private readonly client: EvolutionClient) {}

  async create(input: CreateInstanceInput): Promise<CreatedInstance> {
    const body = CreateInstanceInputSchema.parse(input);
    const raw = await this.client.request("POST", "/instance/create", body);
    return CreatedInstanceSchema.parse(raw);
  }

  async connect(instanceName: string): Promise<ConnectResponse> {
    const raw = await this.client.request("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
    return ConnectResponseSchema.parse(raw);
  }

  async connectionState(instanceName: string): Promise<ConnectionState> {
    const raw = await this.client.request("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const parsed = ConnectionStateResponseSchema.parse(raw);
    return parsed.instance.state;
  }

  async logout(instanceName: string): Promise<void> {
    await this.client.request("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.client.request("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }
}
```

- [ ] **Step 3: Failing test for instance methods**

`packages/evolution-client/src/instance.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { InstanceApi } from "./instance";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("InstanceApi", () => {
  const api = new InstanceApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("create returns parsed instance + qr", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ instance: { instanceName: "x" }, qrcode: { base64: "data:abc" } }), { status: 200 })
    );
    const res = await api.create({ instanceName: "x" });
    expect(res.instance.instanceName).toBe("x");
    expect(res.qrcode?.base64).toBe("data:abc");
  });

  it("connectionState returns the state enum", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ instance: { instanceName: "x", state: "open" } }), { status: 200 })
    );
    const state = await api.connectionState("x");
    expect(state).toBe("open");
  });

  it("connect returns qr response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ base64: "data:img", code: "1@..." }), { status: 200 })
    );
    const res = await api.connect("x");
    expect(res.base64).toBe("data:img");
  });

  it("deleteInstance calls DELETE and resolves void", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await expect(api.deleteInstance("x")).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 4: `src/message.ts`**

```typescript
import type { EvolutionClient } from "./client";
import { SendResultSchema, SendTextInputSchema, type SendResult, type SendTextInput } from "./types";

export class MessageApi {
  constructor(private readonly client: EvolutionClient) {}

  async sendText(instanceName: string, input: SendTextInput): Promise<SendResult> {
    const body = SendTextInputSchema.parse(input);
    const raw = await this.client.request("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, body);
    return SendResultSchema.parse(raw);
  }

  async sendPresence(instanceName: string, number: string, presence: "composing" | "available"): Promise<void> {
    await this.client.request("POST", `/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      number,
      presence,
      delay: 0,
    });
  }
}
```

- [ ] **Step 5: Failing test for message**

`packages/evolution-client/src/message.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { MessageApi } from "./message";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("MessageApi.sendText", () => {
  const api = new MessageApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("posts to /message/sendText/<name> with number + text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ key: { id: "ABC" }, status: "PENDING" }), { status: 200 }));
    const result = await api.sendText("inst-1", { number: "60123456789", text: "Hello" });
    expect(result.key.id).toBe("ABC");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://evo/message/sendText/inst-1");
    expect(JSON.parse(init.body)).toEqual({ number: "60123456789", text: "Hello" });
  });
});
```

- [ ] **Step 6: Update `src/index.ts`**

```typescript
export { EvolutionClient, type EvolutionClientOptions } from "./client";
export { InstanceApi } from "./instance";
export { MessageApi } from "./message";
export * from "./errors";
export * from "./types";
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @evo/evolution-client test
```

Expected: 11/11 passing total (6 client + 4 instance + 1 message).

- [ ] **Step 8: Commit**

```bash
git add packages/evolution-client
git commit -m "feat(evolution-client): instance + message APIs with zod schemas"
```

---

### Task 6: Audit log writer (TDD)

**Files:**
- Create: `apps/web/src/lib/audit.ts`
- Test: `apps/web/src/lib/audit.test.ts`

- [ ] **Step 1: Failing test**

`apps/web/src/lib/audit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    auditLog: { create: vi.fn() },
  },
}));

import { prisma } from "@evo/db";
import { writeAudit } from "./audit";

const mockedCreate = vi.mocked(prisma.auditLog.create);

beforeEach(() => vi.clearAllMocks());

describe("writeAudit", () => {
  it("passes the row straight to prisma.auditLog.create", async () => {
    mockedCreate.mockResolvedValue({} as any);
    await writeAudit({
      workspaceId: "ws-1",
      userId: "u-1",
      action: "instance.created",
      target: "instance:inst-1",
      diff: { instanceName: "x" },
      instanceId: "inst-1",
    });
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-1",
        userId: "u-1",
        action: "instance.created",
        target: "instance:inst-1",
        diff: { instanceName: "x" },
        instanceId: "inst-1",
      },
    });
  });

  it("accepts a null userId for system-initiated actions", async () => {
    mockedCreate.mockResolvedValue({} as any);
    await writeAudit({
      workspaceId: "ws-1",
      userId: null,
      action: "instance.connectionState.changed",
      target: "instance:inst-1",
    });
    expect(mockedCreate.mock.calls[0][0].data.userId).toBeNull();
  });

  it("does not throw if prisma errors — audit failures must never break callers", async () => {
    mockedCreate.mockRejectedValue(new Error("db down"));
    await expect(
      writeAudit({ workspaceId: "ws-1", userId: "u-1", action: "x", target: "y" })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm --filter @evo/web test
```

Expected: FAIL — module './audit' not found.

- [ ] **Step 3: Implement `src/lib/audit.ts`**

```typescript
import { prisma } from "@evo/db";

export interface AuditInput {
  workspaceId: string;
  userId: string | null;
  action: string;
  target: string;
  diff?: unknown;
  instanceId?: string;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        target: input.target,
        diff: (input.diff ?? undefined) as any,
        instanceId: input.instanceId,
      },
    });
  } catch (err) {
    // Audit failure must never break the caller. Log and swallow.
    // eslint-disable-next-line no-console
    console.error("audit.write failed", err);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @evo/web test
```

Expected: 10/10 passing (7 from Plan 0 + 3 audit).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/audit.ts apps/web/src/lib/audit.test.ts
git commit -m "feat(web): writeAudit helper with swallow-on-error semantics"
```

---

### Task 7: `sendViaInstance` helper (TDD)

**Files:**
- Create: `apps/web/src/lib/send.ts`
- Test: `apps/web/src/lib/send.test.ts`

- [ ] **Step 1: Failing test**

`apps/web/src/lib/send.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    instance: { findUnique: vi.fn() },
  },
}));

vi.mock("@evo/queue", () => ({
  tokenBucket: vi.fn(),
}));

vi.mock("@evo/evolution-client", () => ({
  EvolutionClient: vi.fn(),
  MessageApi: vi.fn(),
}));

vi.mock("./audit", () => ({
  writeAudit: vi.fn(),
}));

import { prisma } from "@evo/db";
import { tokenBucket } from "@evo/queue";
import { EvolutionClient, MessageApi } from "@evo/evolution-client";
import { writeAudit } from "./audit";
import { sendViaInstance } from "./send";

const findInstance = vi.mocked(prisma.instance.findUnique);
const mockedBucket = vi.mocked(tokenBucket);
const mockedMessageApi = vi.mocked(MessageApi);
const mockedAudit = vi.mocked(writeAudit);

beforeEach(() => vi.clearAllMocks());

function fakeBucket(granted = true) {
  return { take: vi.fn().mockResolvedValue({ granted, waitedMs: 0, remaining: 4 }) };
}
function fakeMessageApi() {
  const sendText = vi.fn().mockResolvedValue({ key: { id: "mid-1" }, status: "PENDING" });
  const sendPresence = vi.fn().mockResolvedValue(undefined);
  return { sendText, sendPresence };
}

describe("sendViaInstance", () => {
  it("happy path: takes a token, sends presence, sends text, writes audit", async () => {
    findInstance.mockResolvedValue({
      id: "inst-1",
      workspaceId: "ws-1",
      evolutionInstanceName: "inst-x",
      evolutionApiKey: "K",
    } as any);
    const bucket = fakeBucket(true);
    mockedBucket.mockReturnValue(bucket as any);
    const api = fakeMessageApi();
    mockedMessageApi.mockImplementation(() => api as any);

    const result = await sendViaInstance("inst-1", { type: "text", to: "60123", text: "hi", userId: "u-1" });

    expect(bucket.take).toHaveBeenCalledWith({ waitMs: 300000 });
    expect(api.sendPresence).toHaveBeenCalledWith("inst-x", "60123", "composing");
    expect(api.sendText).toHaveBeenCalledWith("inst-x", { number: "60123", text: "hi" });
    expect(result).toEqual({ key: { id: "mid-1" }, status: "PENDING" });
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-1",
      userId: "u-1",
      action: "message.sent",
      target: "instance:inst-1",
      instanceId: "inst-1",
    }));
  });

  it("throws when bucket denies (waitMs exhausted)", async () => {
    findInstance.mockResolvedValue({
      id: "inst-1", workspaceId: "ws-1", evolutionInstanceName: "x", evolutionApiKey: "K",
    } as any);
    const bucket = fakeBucket(false);
    mockedBucket.mockReturnValue(bucket as any);

    await expect(sendViaInstance("inst-1", { type: "text", to: "60123", text: "hi", userId: "u-1" }))
      .rejects.toThrow(/throttl/i);
  });

  it("throws when instance not found", async () => {
    findInstance.mockResolvedValue(null);
    await expect(sendViaInstance("missing", { type: "text", to: "60123", text: "hi", userId: "u-1" }))
      .rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm --filter @evo/web test
```

Expected: FAIL — module './send' not found.

- [ ] **Step 3: Implement `src/lib/send.ts`**

```typescript
import { prisma } from "@evo/db";
import { tokenBucket } from "@evo/queue";
import { EvolutionClient, MessageApi } from "@evo/evolution-client";
import { writeAudit } from "./audit";

const DEFAULT_BUCKET = { capacity: 10, refillPerSecond: 0.5 };
const WAIT_MS = 5 * 60 * 1000;

export interface SendTextPayload {
  type: "text";
  to: string;
  text: string;
  userId: string | null;
}

export async function sendViaInstance(instanceId: string, payload: SendTextPayload) {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) throw new Error(`instance not found: ${instanceId}`);

  const bucket = tokenBucket(instanceId, DEFAULT_BUCKET);
  const taken = await bucket.take({ waitMs: WAIT_MS });
  if (!taken.granted) {
    throw new Error(`throttled: bucket empty for instance ${instanceId} after ${taken.waitedMs}ms`);
  }

  const base = process.env.EVOLUTION_BASE_URL;
  if (!base) throw new Error("EVOLUTION_BASE_URL not set");
  const client = new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey });
  const api = new MessageApi(client);

  try {
    await api.sendPresence(instance.evolutionInstanceName, payload.to, "composing");
  } catch {
    // presence is best-effort
  }

  const result = await api.sendText(instance.evolutionInstanceName, { number: payload.to, text: payload.text });

  await writeAudit({
    workspaceId: instance.workspaceId,
    userId: payload.userId,
    action: "message.sent",
    target: `instance:${instance.id}`,
    instanceId: instance.id,
    diff: { to: payload.to, textPreview: payload.text.slice(0, 80) },
  });

  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @evo/web test
```

Expected: 13/13 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/send.ts apps/web/src/lib/send.test.ts
git commit -m "feat(web): sendViaInstance helper with token bucket + audit"
```

---

### Task 8: Instances API — GET list + POST create

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/route.ts`

- [ ] **Step 1: Implement route**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError } from "@evo/shared";

const createSchema = z.object({
  label: z.string().min(1).max(80),
});

function evolutionInstanceName(workspaceSlug: string, label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = randomBytes(4).toString("hex");
  return `${workspaceSlug}-${slug || "instance"}-${suffix}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instances = await db.instance.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ instances });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }

    const evolutionName = evolutionInstanceName(slug, parsed.data.label);
    const base = process.env.EVOLUTION_BASE_URL;
    const globalKey = process.env.EVOLUTION_GLOBAL_API_KEY;
    if (!base || !globalKey) {
      return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    }
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: globalKey }));
    const created = await api.create({ instanceName: evolutionName, qrcode: true });

    const apiKey = created.hash ?? globalKey;

    const db = tenantClient(workspace.id);
    const instance = await db.instance.create({
      data: {
        label: parsed.data.label,
        evolutionInstanceName: evolutionName,
        evolutionApiKey: apiKey,
        connectionState: "connecting",
      } as any,
    });

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "instance.created",
      target: `instance:${instance.id}`,
      instanceId: instance.id,
      diff: { label: parsed.data.label, evolutionInstanceName: evolutionName },
    });

    return NextResponse.json({ instance }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @evo/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/instances"
git commit -m "feat(web): instances API GET list + POST create with Evolution wiring"
```

---

### Task 9: Instance detail / QR / state / delete routes

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/[id]/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/[id]/qr/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/[id]/state/route.ts`

- [ ] **Step 1: GET detail + DELETE — `[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");
    return NextResponse.json({ instance });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (base) {
      const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
      try {
        await api.deleteInstance(instance.evolutionInstanceName);
      } catch {
        // best-effort: even if Evolution is down we delete locally
      }
    }
    await db.instance.delete({ where: { id } });

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "instance.deleted",
      target: `instance:${id}`,
      instanceId: null as unknown as undefined,
      diff: { label: instance.label, evolutionInstanceName: instance.evolutionInstanceName },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: GET QR — `[id]/qr/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi, EvolutionNotFoundError } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
    try {
      const qr = await api.connect(instance.evolutionInstanceName);
      return NextResponse.json({ qr });
    } catch (e) {
      if (e instanceof EvolutionNotFoundError) {
        return NextResponse.json({ error: "EVOLUTION_INSTANCE_GONE" }, { status: 410 });
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: GET state — `[id]/state/route.ts`** (also persists to the row so the list view is fresh)

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ state: instance.connectionState });
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
    let state = instance.connectionState;
    try {
      const fresh = await api.connectionState(instance.evolutionInstanceName);
      state = fresh;
      if (fresh !== instance.connectionState) {
        await db.instance.update({
          where: { id },
          data: { connectionState: fresh, lastSeenAt: fresh === "open" ? new Date() : instance.lastSeenAt },
        });
      }
    } catch {
      // fall back to cached state
    }
    return NextResponse.json({ state });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/instances/[id]"
git commit -m "feat(web): instance detail, QR, connection-state, delete routes"
```

Expected: typecheck PASS.

---

### Task 10: Send-test API endpoint

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/[id]/send-test/route.ts`

- [ ] **Step 1: Route**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance } from "@/lib/send";
import { AppError, NotFoundError } from "@evo/shared";

const bodySchema = z.object({
  to: z.string().min(8),
  text: z.string().min(1).max(4000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    try {
      const result = await sendViaInstance(id, {
        type: "text",
        to: parsed.data.to,
        text: parsed.data.text,
        userId,
      });
      return NextResponse.json({ ok: true, result });
    } catch (err: any) {
      if (String(err?.message ?? "").startsWith("throttled")) {
        return NextResponse.json({ error: "THROTTLED" }, { status: 429 });
      }
      return NextResponse.json({ error: "SEND_FAILED", message: String(err?.message ?? err) }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/instances/[id]/send-test"
git commit -m "feat(web): POST send-test route using sendViaInstance"
```

---

### Task 11: Instance list + create wizard UI

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/instances/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/new/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/new/create-form.tsx`
- Modify: `apps/web/messages/en-GB.json` (add `instances.*`)

- [ ] **Step 1: Add i18n keys**

In `apps/web/messages/en-GB.json`, add an `"instances"` namespace (insert at top level, valid JSON):

```json
  "instances": {
    "title": "WhatsApp instances",
    "new": "New instance",
    "label": "Label",
    "labelPlaceholder": "e.g. Sales line",
    "state": "State",
    "stateConnecting": "Connecting",
    "stateOpen": "Connected",
    "stateClose": "Disconnected",
    "stateUnknown": "Unknown",
    "createCta": "Create instance",
    "pairTitle": "Scan to pair",
    "pairHint": "Open WhatsApp on your phone → Linked devices → Link a device.",
    "delete": "Delete instance",
    "confirmDelete": "Delete this instance? This cannot be undone.",
    "openDetail": "Open",
    "testSend": "Send test message",
    "to": "To (number with country code)",
    "text": "Message",
    "send": "Send",
    "sentOk": "Sent",
    "sentFailed": "Send failed",
    "throttled": "Rate-limited; try again later"
  },
```

(Append a comma after the previous block if needed — keep the JSON valid.)

- [ ] **Step 2: List page — `apps/web/src/app/[workspaceSlug]/instances/page.tsx`**

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";

export default async function InstancesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ orderBy: { createdAt: "desc" } });

  function stateLabel(state: string) {
    return t(`instances.state${state[0].toUpperCase() + state.slice(1)}` as any);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("instances.title")}</h1>
        <Link href={`/${workspaceSlug}/instances/new`} className="bg-black text-white rounded p-2 px-4">
          {t("instances.new")}
        </Link>
      </div>
      <ul className="border rounded divide-y">
        {instances.map((inst) => (
          <li key={inst.id} className="p-3 flex justify-between items-center">
            <span>
              <strong>{inst.label}</strong>{" "}
              <span className="text-sm text-gray-500">— {stateLabel(inst.connectionState)}</span>
              {inst.phoneNumber && <span className="text-sm text-gray-500"> · {inst.phoneNumber}</span>}
            </span>
            <Link href={`/${workspaceSlug}/instances/${inst.id}`} className="text-sm underline">
              {t("instances.openDetail")}
            </Link>
          </li>
        ))}
        {instances.length === 0 && <li className="p-3 text-gray-500 text-sm">—</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: New-instance wizard page — `apps/web/src/app/[workspaceSlug]/instances/new/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import CreateForm from "./create-form";

export default async function NewInstancePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">{t("instances.new")}</h1>
      <CreateForm workspaceSlug={workspaceSlug} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/instances/new/create-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function CreateForm({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    const { instance } = await res.json();
    router.push(`/${workspaceSlug}/instances/${instance.id}/pair`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm">{t("instances.label")}</span>
        <input
          className="w-full border rounded p-2 mt-1"
          placeholder={t("instances.labelPlaceholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={80}
        />
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">
        {t("instances.createCta")}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/instances/page.tsx" "apps/web/src/app/[workspaceSlug]/instances/new" apps/web/messages/en-GB.json
git commit -m "feat(web): instances list + create wizard"
```

---

### Task 12: Instance detail + QR pair page

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/delete-button.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/pair/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/pair/pair-view.tsx`

- [ ] **Step 1: Detail page**

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import DeleteButton from "./delete-button";

export default async function InstanceDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const inst = await db.instance.findUnique({ where: { id } });
  if (!inst) notFound();

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">{inst.label}</h1>
      <dl className="grid grid-cols-2 gap-y-2">
        <dt className="text-sm text-gray-500">{t("instances.state")}</dt>
        <dd>{inst.connectionState}</dd>
        <dt className="text-sm text-gray-500">Phone</dt>
        <dd>{inst.phoneNumber ?? "—"}</dd>
      </dl>
      <div className="flex gap-3">
        <Link
          href={`/${workspaceSlug}/instances/${id}/pair`}
          className="bg-black text-white rounded p-2 px-4 text-sm"
        >
          {t("instances.pairTitle")}
        </Link>
        <Link
          href={`/${workspaceSlug}/instances/${id}/test-send`}
          className="border rounded p-2 px-4 text-sm"
        >
          {t("instances.testSend")}
        </Link>
        <DeleteButton workspaceSlug={workspaceSlug} instanceId={id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DeleteButton client component**

`apps/web/src/app/[workspaceSlug]/instances/[id]/delete-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function DeleteButton({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm(t("instances.confirmDelete"))) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert("Delete failed");
      return;
    }
    router.push(`/${workspaceSlug}/instances`);
    router.refresh();
  }

  return (
    <button onClick={onClick} disabled={busy} className="text-red-600 text-sm underline">
      {t("instances.delete")}
    </button>
  );
}
```

- [ ] **Step 3: Pair page (server shell + client view that polls)**

`apps/web/src/app/[workspaceSlug]/instances/[id]/pair/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import PairView from "./pair-view";

export default async function PairPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-2xl font-semibold">{t("instances.pairTitle")}</h1>
      <p className="text-sm text-gray-600">{t("instances.pairHint")}</p>
      <PairView workspaceSlug={workspaceSlug} instanceId={id} />
    </div>
  );
}
```

`apps/web/src/app/[workspaceSlug]/instances/[id]/pair/pair-view.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function PairView({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<string>("connecting");
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    async function pollQr() {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/qr`);
      if (!alive) return;
      if (res.ok) {
        const { qr } = await res.json();
        setQr(qr?.base64 ?? null);
      }
    }
    async function pollState() {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/state`);
      if (!alive) return;
      if (res.ok) {
        const { state } = await res.json();
        setState(state);
        if (state === "open") {
          router.refresh();
        }
      }
    }

    pollQr();
    pollState();
    const qrTimer = setInterval(pollQr, 25000);
    const stateTimer = setInterval(pollState, 3000);
    return () => {
      alive = false;
      clearInterval(qrTimer);
      clearInterval(stateTimer);
    };
  }, [workspaceSlug, instanceId, router]);

  return (
    <div className="space-y-3">
      {qr ? (
        // Evolution returns the QR as a data URL (data:image/png;base64,…)
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code" className="w-64 h-64 border rounded bg-white p-2" />
      ) : (
        <div className="w-64 h-64 border rounded flex items-center justify-center text-gray-400">…</div>
      )}
      <p className="text-sm">State: <code>{state}</code></p>
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/instances/[id]"
git commit -m "feat(web): instance detail + QR pair page with polling"
```

---

### Task 13: Send-test UI

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/test-send/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/instances/[id]/test-send/send-form.tsx`

- [ ] **Step 1: Server shell**

```tsx
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import SendForm from "./send-form";

export default async function TestSendPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">{t("instances.testSend")}</h1>
      <SendForm workspaceSlug={workspaceSlug} instanceId={id} />
    </div>
  );
}
```

- [ ] **Step 2: Client form**

```tsx
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function SendForm({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const t = useTranslations();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/send-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, text }),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback(t("instances.sentOk"));
      setText("");
      return;
    }
    if (res.status === 429) {
      setFeedback(t("instances.throttled"));
      return;
    }
    setFeedback(t("instances.sentFailed"));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-sm">{t("instances.to")}</span>
        <input
          className="w-full border rounded p-2 mt-1"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="60123456789"
          required
          minLength={8}
        />
      </label>
      <label className="block">
        <span className="text-sm">{t("instances.text")}</span>
        <textarea
          className="w-full border rounded p-2 mt-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          rows={4}
          maxLength={4000}
        />
      </label>
      {feedback && <p className="text-sm">{feedback}</p>}
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("instances.send")}</button>
    </form>
  );
}
```

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/instances/[id]/test-send"
git commit -m "feat(web): send-test UI for instances"
```

---

### Task 14: Instance link in workspace nav

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx`
- Modify: `apps/web/messages/en-GB.json` (already has `nav.dashboard`/`nav.members`; add `nav.instances`)

- [ ] **Step 1: Add nav key**

In `apps/web/messages/en-GB.json`, inside the existing `"nav"` namespace, add:

```json
    "instances": "Instances",
```

(Make sure the JSON is still valid.)

- [ ] **Step 2: Add the link in the sidebar**

In `apps/web/src/app/[workspaceSlug]/layout.tsx`, inside the `<aside>` element add the link between Dashboard and Members:

```tsx
        <Link href={`/${workspaceSlug}/instances`} className="block">{t("nav.instances")}</Link>
```

So the aside becomes:

```tsx
      <aside className="w-56 bg-gray-100 p-4 space-y-2">
        <Link href={`/${workspaceSlug}/dashboard`} className="block font-semibold">{t("nav.dashboard")}</Link>
        <Link href={`/${workspaceSlug}/instances`} className="block">{t("nav.instances")}</Link>
        <Link href={`/${workspaceSlug}/settings/members`} className="block">{t("nav.members")}</Link>
      </aside>
```

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/layout.tsx" apps/web/messages/en-GB.json
git commit -m "feat(web): add Instances to workspace nav"
```

---

### Task 15: Worker stub — instance state heartbeat repeatable

**Files:**
- Modify: `apps/worker/package.json` (add bullmq dep)
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Add bullmq + ioredis dep, switch to ESM**

The top-level `await` in Step 2 requires `apps/worker/package.json` to declare `"type": "module"`. Add it and the new deps:

```json
{
  "name": "@evo/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@evo/db": "workspace:*",
    "@evo/queue": "workspace:*",
    "@evo/shared": "workspace:*",
    "bullmq": "^5.30.0",
    "ioredis": "^5.4.0",
    "pino": "^9.10.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0",
    "typescript": "5.7.2",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

Run `pnpm install` from repo root.

- [ ] **Step 2: Update worker entry point**

`apps/worker/src/index.ts`:

```typescript
import http from "node:http";
import pino from "pino";
import { Queue, Worker, type Processor } from "bullmq";
import { redis } from "@evo/queue";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));

const connection = redis();

const HEARTBEAT_QUEUE = "instance-state-tick";

const heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection });

await heartbeatQueue.add(
  "tick",
  {},
  { repeat: { every: 60000 }, jobId: "instance-state-tick:repeat" }
);

const process_: Processor = async (job) => {
  log.info({ id: job.id }, "instance-state-tick fired");
  // Plan 2 will fan this out to per-instance connection-state checks.
};

new Worker(HEARTBEAT_QUEUE, process_, { connection });

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 4100);
server.listen(port, () => log.info({ port }, "worker started"));
```

(Note: top-level `await` requires `"module": "ESNext"` and Node ≥ 20 — both are already set.)

- [ ] **Step 3: Quick boot check**

```bash
docker compose up -d redis-manager
PORT=4101 REDIS_URL=redis://localhost:6379/0 pnpm --filter @evo/worker dev > /tmp/worker.log 2>&1 &
WORKER_PID=$!
sleep 8
curl -s http://localhost:4101/healthz
kill $WORKER_PID 2>/dev/null
sleep 2
grep "worker started" /tmp/worker.log
```

Expected: `{"ok":true}` from curl, "worker started" line in the log.

- [ ] **Step 4: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): wire BullMQ + instance-state-tick repeatable heartbeat"
```

---

### Task 16: Playwright e2e — instance lifecycle (no real WhatsApp pairing)

**Files:**
- Create: `tests/e2e/instance-lifecycle.spec.ts`

- [ ] **Step 1: Spec**

The test mocks Evolution's `/instance/create` and `/instance/connectionState` by pointing the manager at a local stub server only Playwright launches. The cleanest way is to override `EVOLUTION_BASE_URL` in the env before the dev server starts — easiest path: spin up a tiny stub server inside the test using `node:http`, then start the web dev server with `EVOLUTION_BASE_URL=http://localhost:18080`.

We'll set `EVOLUTION_BASE_URL` in `apps/web/.env.local` (gitignored) before the test runs, and tear it down after. To keep things simple, the test assumes the developer has already set `EVOLUTION_BASE_URL=http://localhost:18080` in `apps/web/.env.local` for the duration of the test run — and the test spins up a stub server on 18080.

`tests/e2e/instance-lifecycle.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const PORT = 18080;

test.beforeAll(async () => {
  resetDb();

  stub = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({
        instance: { instanceName: "stub-instance" },
        hash: "stub-key",
        qrcode: { base64: "data:image/png;base64,iVBORw0KGgo=" },
      }));
      return;
    }
    if (req.url?.startsWith("/instance/connect/") && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ base64: "data:image/png;base64,iVBORw0KGgo=", code: "stub" }));
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/") && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub-instance", state: "open" } }));
      return;
    }
    if (req.url?.startsWith("/instance/delete/") && req.method === "DELETE") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url?.startsWith("/message/sendText/") && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ key: { id: "MSG_STUB_1" }, status: "PENDING" }));
      return;
    }
    if (req.url?.startsWith("/chat/sendPresence/") && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => stub.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

test("admin creates instance, sees QR, sends a test message, deletes the instance", async ({ browser }) => {
  const ownerEmail = freshEmail("owner");
  const pw = "hunter22hunter";

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // sign up + onboard
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(ownerEmail);
  await page.getByPlaceholder("Password").fill(pw);
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Plan 1 Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");

  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // go to instances → new
  await page.goto(`/${slug}/instances`);
  await page.getByRole("link", { name: /New instance/i }).click();
  await page.getByPlaceholder(/Sales line/).fill("Sales WA");
  await page.getByRole("button", { name: /Create instance/i }).click();

  // pair page should render the stub QR
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);
  await expect(page.locator("img[alt='QR code']")).toBeVisible({ timeout: 10000 });

  // state should poll to "open"
  await expect(page.getByText(/State:\s*open/)).toBeVisible({ timeout: 10000 });

  // navigate to the detail page
  const pairUrl = page.url();
  const instanceId = pairUrl.match(/\/instances\/([^/]+)\/pair/)![1];
  await page.goto(`/${slug}/instances/${instanceId}/test-send`);
  await page.getByPlaceholder("60123456789").fill("60123456789");
  await page.getByRole("textbox", { name: /Message/i }).fill("hello from e2e");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText(/Sent/i)).toBeVisible({ timeout: 5000 });

  // delete the instance
  page.on("dialog", (d) => d.accept());
  await page.goto(`/${slug}/instances/${instanceId}`);
  await page.getByRole("button", { name: /Delete instance/i }).click();
  await page.waitForURL(`**/${slug}/instances`);
});
```

- [ ] **Step 2: Make sure dev env points web at the stub**

Append/update `apps/web/.env.local` (gitignored):

```
EVOLUTION_BASE_URL=http://localhost:18080
EVOLUTION_GLOBAL_API_KEY=stub-key
```

- [ ] **Step 3: Run**

```bash
docker compose up -d postgres-manager redis-manager
pnpm --filter @evo/db exec prisma migrate deploy
pnpm --filter @evo/web test:e2e -- instance-lifecycle.spec.ts
```

Expected: 1 PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/instance-lifecycle.spec.ts
git commit -m "test(e2e): instance create → QR → send → delete with stub Evolution"
```

---

### Task 17: Tenancy isolation regression test

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instances/route.test.ts`

This is a unit test (not e2e) that proves an Instance row created in workspace A is invisible to workspace B via `tenantClient`. We don't exercise the route handler itself — we exercise the underlying tenancy guard.

- [ ] **Step 1: Test**

`apps/web/src/app/api/workspaces/[slug]/instances/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

// This test talks to a real Postgres via the @evo/db tenant client.
// It mirrors packages/db/src/test-setup.ts behaviour for app-level tests.
beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public";
  }
  execSync("node_modules/.bin/prisma migrate deploy", {
    cwd: __dirname + "/../../../../../../packages/db",
    stdio: "inherit",
    env: { ...process.env },
  });
});

const { prisma, tenantClient } = await import("@evo/db");

describe("tenant isolation: instances", () => {
  it("workspace B cannot read instances created in workspace A", async () => {
    await prisma.auditLog.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();

    const a = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
    const b = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });

    const dbA = tenantClient(a.id);
    await dbA.instance.create({
      data: {
        label: "in-A",
        evolutionInstanceName: "evo-a-" + Date.now(),
        evolutionApiKey: "k",
      } as any,
    });

    const dbB = tenantClient(b.id);
    const listForB = await dbB.instance.findMany();
    expect(listForB).toHaveLength(0);

    const listForA = await dbA.instance.findMany();
    expect(listForA).toHaveLength(1);
  });
});
```

(Note: this test runs against the `evolution_manager_test` Postgres which already has Plan 0's migrations; the new Task 2 migration is added on `prisma migrate deploy`.)

- [ ] **Step 2: Run**

```bash
pnpm --filter @evo/web test
```

Expected: 14/14 passing.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/instances/route.test.ts"
git commit -m "test(web): tenant isolation regression for Instance reads"
```

---

### Task 18: Plan 1 review pass

**Files:** (none — verification only)

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm -r test
```

Expected:
- typecheck: PASS across `@evo/db`, `@evo/shared`, `@evo/queue`, `@evo/evolution-client`, `@evo/web`, `@evo/worker`, `@evo/ingest`.
- tests: PASS, totals:
  - `@evo/shared` 8
  - `@evo/db` 3
  - `@evo/queue` 4
  - `@evo/evolution-client` 11
  - `@evo/web` 14
  - `@evo/ingest`/`@evo/worker` passWithNoTests
  - Total: 40 unit + 2 e2e (Plan 0's + new instance-lifecycle).

- [ ] **Step 2: Manual smoke (optional, only if a real WhatsApp number is available)**

```bash
docker compose up -d
# wait for evolution-api healthy
open http://localhost:3000
# Sign in, create instance, scan with real WhatsApp Linked Devices, see state = open, send a test message to yourself.
```

- [ ] **Step 3: No commit needed — Plan 1 done.**

---

## Plan 1 verification checklist

After Task 18:

- [ ] `docker compose ps` shows postgres-manager, redis-manager, postgres-evolution, redis-evolution, evolution-api all healthy.
- [ ] `pnpm typecheck` passes across every package.
- [ ] `pnpm -r test` passes; counts match Task 18 expectations.
- [ ] Both e2e specs (auth-and-workspace.spec.ts from Plan 0 and instance-lifecycle.spec.ts new) pass.
- [ ] Tenancy isolation regression test in `route.test.ts` passes.
- [ ] Audit log rows appear in `AuditLog` table after creating, sending, deleting.
- [ ] (Optional manual smoke) real WhatsApp pairing works end-to-end.

When all checked: Plan 1 done. Next is **Plan 2 — Inbox + realtime** (webhook ingest pipeline, Socket.IO fan-out, three-pane inbox UI, assignments, notes).
