# Ban-Health & Deliverability Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-instance WhatsApp account-health system: a 0–100 health score with risk levels, enforceable warm-up ramps that cap bulk sends per number, automatic protective pausing of broadcasts when a number goes at-risk, a health dashboard, and health webhook events.

**Architecture:** Pure scoring/ramp logic lives in a new `@evo/health` package (fully unit-testable, no I/O). Bulk sends are counted against an atomic Redis daily counter at the existing `sendViaInstance` chokepoint and rejected when a ramp cap is hit. A new `health-tick` worker snapshots scores every 15 minutes and applies auto-protection. The Next.js app adds a "Number Health" dashboard and REST routes. This mirrors the codebase's established split: pure logic in `packages/*`, periodic work in `apps/worker`, UI + API in `apps/web`.

**Tech Stack:** TypeScript, Prisma + Postgres, Redis (ioredis via `@evo/queue`), BullMQ, Next.js 15 App Router, Zod, next-intl, Vitest.

---

## Conventions (read before starting)

- Packages use `"main": "src/index.ts"`, `"test": "vitest run --passWithNoTests"`, `"typecheck": "tsc --noEmit"`, tsconfig extends `../../tsconfig.base.json`. Copy `packages/schedule` as the template for a new pure package.
- Prisma models must be added to `TENANTED_MODELS` in `packages/db/src/tenant.ts` if they carry `workspaceId` and are accessed via `tenantClient`.
- Web API routes follow the pattern in `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/route.ts`: `requireMember(slug, role)`, `tenantClient(workspace.id)`, `z.safeParse`, catch `AppError` → `NextResponse.json({ error: e.code }, { status: e.status })`.
- Worker tick tests mock `@evo/send` with `vi.mock` and use the real test Postgres (see `apps/worker/src/broadcast-send.test.ts`). Worker tests need `DATABASE_URL`; the worker test-setup handles migrations — check `apps/worker/src/test-setup.ts`.
- Redis in tests: package `@evo/queue` exposes `redis()`. The health counter tests should use a unique key per test run (include `Date.now()`), and clean up with `redis().del(key)`.
- Every task ends with a commit. Run the relevant package's tests before committing.

## File Structure

**Create:**
- `packages/health/package.json`, `tsconfig.json`
- `packages/health/src/index.ts` — re-exports
- `packages/health/src/score.ts` — `computeHealthScore`, types `HealthMetrics`, `RiskLevel`, `Factor`
- `packages/health/src/ramp.ts` — `rampCapForDay`, `RampPolicy`
- `packages/health/src/keys.ts` — `bulkSendKey`
- `packages/health/src/score.test.ts`, `ramp.test.ts`, `keys.test.ts`
- `packages/db/prisma/migrations/<ts>_health_suite/migration.sql` (via `migrate dev`)
- `apps/worker/src/health-tick.ts` + `health-tick.test.ts`
- `apps/worker/src/health-metrics.ts` + `health-metrics.test.ts` — Prisma aggregation → `HealthMetrics`
- `apps/web/src/app/[workspaceSlug]/health/page.tsx` + `health-client.tsx` (client policy editor + ack buttons)
- `apps/web/src/app/api/workspaces/[slug]/health/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/policy/route.ts`
- `apps/web/src/app/api/workspaces/[slug]/health/alerts/[id]/ack/route.ts`

**Modify:**
- `packages/db/prisma/schema.prisma` — new models + enums
- `packages/db/src/tenant.ts` — register new tenanted models
- `packages/send/src/index.ts` — `opts.origin`, Redis counting, `RampCapError`
- `packages/send/package.json` — add `@evo/health` dep
- All `sendViaInstance` call sites — pass `origin`
- `apps/worker/src/index.ts` — register `health-tick` queue/worker
- `apps/worker/src/broadcast-scheduler.ts` — allowance pre-check
- `apps/worker/package.json` — add `@evo/health` dep
- `apps/web/src/components/shell/sidebar.tsx` — add Number Health nav item
- `apps/web/src/app/[workspaceSlug]/layout.tsx` — add `health` label
- `apps/web/messages/en-GB.json` — nav + health i18n keys
- `apps/web/src/app/api/workspaces/[slug]/webhook-subscriptions/route.ts` — add health event kinds to `VALID_EVENTS`

---

## Task 1: Scaffold `@evo/health` package

**Files:**
- Create: `packages/health/package.json`
- Create: `packages/health/tsconfig.json`
- Create: `packages/health/src/index.ts`

- [ ] **Step 1: Create `packages/health/package.json`**

```json
{
  "name": "@evo/health",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/health/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 3: Create placeholder `packages/health/src/index.ts`**

```typescript
export * from "./score";
export * from "./ramp";
export * from "./keys";
```

(This will not typecheck until Tasks 2–4 create those files. That's fine — do not run typecheck yet.)

- [ ] **Step 4: Install workspace deps**

Run: `pnpm install`
Expected: completes, links `@evo/health` into the workspace.

- [ ] **Step 5: Commit**

```bash
git add packages/health pnpm-lock.yaml
git commit -m "chore(health): scaffold @evo/health package"
```

---

## Task 2: Ramp math (`rampCapForDay`)

**Files:**
- Create: `packages/health/src/ramp.ts`
- Test: `packages/health/src/ramp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { rampCapForDay, type RampPolicy } from "./ramp";

const policy: RampPolicy = { rampBaseDaily: 20, rampGrowthPct: 15, rampMaxDaily: 500 };

describe("rampCapForDay", () => {
  it("returns base on day 0", () => {
    expect(rampCapForDay(policy, 0)).toBe(20);
  });
  it("compounds growth per day (floored)", () => {
    // 20 * 1.15^1 = 23, 20 * 1.15^2 = 26.45 -> 26
    expect(rampCapForDay(policy, 1)).toBe(23);
    expect(rampCapForDay(policy, 2)).toBe(26);
  });
  it("clamps at max", () => {
    expect(rampCapForDay(policy, 100)).toBe(500);
  });
  it("treats negative dayIndex as day 0", () => {
    expect(rampCapForDay(policy, -3)).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/health test`
Expected: FAIL — cannot find module `./ramp`.

- [ ] **Step 3: Write the implementation**

```typescript
export interface RampPolicy {
  rampBaseDaily: number;
  rampGrowthPct: number;
  rampMaxDaily: number;
}

export function rampCapForDay(policy: RampPolicy, dayIndex: number): number {
  const day = Math.max(0, Math.floor(dayIndex));
  const raw = policy.rampBaseDaily * Math.pow(1 + policy.rampGrowthPct / 100, day);
  return Math.min(policy.rampMaxDaily, Math.floor(raw));
}

export function daysSince(start: Date, now: Date): number {
  const ms = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/health test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/health/src/ramp.ts packages/health/src/ramp.test.ts
git commit -m "feat(health): ramp cap math with compounding growth and max clamp"
```

---

## Task 3: Redis key helper (`bulkSendKey`)

**Files:**
- Create: `packages/health/src/keys.ts`
- Test: `packages/health/src/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { bulkSendKey, utcDateStamp } from "./keys";

describe("bulkSendKey", () => {
  it("builds a per-instance per-UTC-day key", () => {
    const d = new Date("2026-07-03T23:30:00.000Z");
    expect(bulkSendKey("inst_1", d)).toBe("health:bulk:inst_1:2026-07-03");
  });
  it("uses UTC day, not local", () => {
    const d = new Date("2026-07-03T23:30:00.000Z");
    expect(utcDateStamp(d)).toBe("2026-07-03");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/health test`
Expected: FAIL — cannot find module `./keys`.

- [ ] **Step 3: Write the implementation**

```typescript
export function utcDateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function bulkSendKey(instanceId: string, d: Date): string {
  return `health:bulk:${instanceId}:${utcDateStamp(d)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/health test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/health/src/keys.ts packages/health/src/keys.test.ts
git commit -m "feat(health): redis bulk-send counter key helper (UTC day)"
```

---

## Task 4: Health scoring (`computeHealthScore`)

**Files:**
- Create: `packages/health/src/score.ts`
- Test: `packages/health/src/score.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computeHealthScore, type HealthMetrics } from "./score";

const good: HealthMetrics = {
  businessInitiatedConversations: 50,
  replyRatio: 0.6,
  failureRate: 0.01,
  outboundOnlyConversationPct: 0.1,
  disconnectCount: 0,
  capUsagePct: 0.3,
};

describe("computeHealthScore", () => {
  it("scores a healthy instance high", () => {
    const r = computeHealthScore(good);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.risk).toBe("healthy");
  });

  it("scores a spammy instance at_risk", () => {
    const bad: HealthMetrics = {
      businessInitiatedConversations: 200,
      replyRatio: 0.02,
      failureRate: 0.4,
      outboundOnlyConversationPct: 0.9,
      disconnectCount: 5,
      capUsagePct: 1,
    };
    const r = computeHealthScore(bad);
    expect(r.score).toBeLessThan(40);
    expect(r.risk).toBe("at_risk");
  });

  it("returns caution in the middle band", () => {
    const mid: HealthMetrics = {
      businessInitiatedConversations: 40,
      replyRatio: 0.2,
      failureRate: 0.1,
      outboundOnlyConversationPct: 0.5,
      disconnectCount: 1,
      capUsagePct: 0.6,
    };
    const r = computeHealthScore(mid);
    expect(r.risk).toBe("caution");
  });

  it("treats sparse reply data as neutral, not punitive", () => {
    const sparse: HealthMetrics = {
      businessInitiatedConversations: 3,
      replyRatio: 0,
      failureRate: 0,
      outboundOnlyConversationPct: 0,
      disconnectCount: 0,
      capUsagePct: 0,
    };
    const r = computeHealthScore(sparse);
    const replyFactor = r.factors.find((f) => f.key === "replyRatio");
    expect(replyFactor?.insufficientData).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("always includes all five factors", () => {
    const r = computeHealthScore(good);
    expect(r.factors.map((f) => f.key).sort()).toEqual(
      ["capUsage", "disconnects", "failureRate", "outboundOnly", "replyRatio"],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/health test`
Expected: FAIL — cannot find module `./score`.

- [ ] **Step 3: Write the implementation**

```typescript
export type RiskLevel = "healthy" | "caution" | "at_risk";

export interface HealthMetrics {
  /** Distinct contacts we messaged first in the window. */
  businessInitiatedConversations: number;
  /** 0..1 — of business-initiated conversations, share that got a reply. */
  replyRatio: number;
  /** 0..1 — failed / attempted bulk targets in the window. */
  failureRate: number;
  /** 0..1 — conversations with outbound but zero inbound. */
  outboundOnlyConversationPct: number;
  /** connection flaps observed in the window. */
  disconnectCount: number;
  /** 0..1 — today's bulk sends / today's ramp cap. */
  capUsagePct: number;
}

export interface Factor {
  key: "replyRatio" | "outboundOnly" | "failureRate" | "disconnects" | "capUsage";
  /** 0..1 — 1 is perfect, 0 is worst. */
  goodness: number;
  weight: number;
  insufficientData?: boolean;
}

const WEIGHTS = { replyRatio: 40, outboundOnly: 20, failureRate: 20, disconnects: 10, capUsage: 10 };
const MIN_CONVERSATIONS_FOR_REPLY = 10;
const DISCONNECTS_FULL_PENALTY_AT = 5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeHealthScore(m: HealthMetrics): {
  score: number;
  risk: RiskLevel;
  factors: Factor[];
} {
  const replyInsufficient = m.businessInitiatedConversations < MIN_CONVERSATIONS_FOR_REPLY;
  const factors: Factor[] = [
    {
      key: "replyRatio",
      // Reply ratio of 0.3+ is treated as fully healthy.
      goodness: replyInsufficient ? 1 : clamp01(m.replyRatio / 0.3),
      weight: WEIGHTS.replyRatio,
      insufficientData: replyInsufficient,
    },
    { key: "outboundOnly", goodness: clamp01(1 - m.outboundOnlyConversationPct), weight: WEIGHTS.outboundOnly },
    { key: "failureRate", goodness: clamp01(1 - m.failureRate / 0.2), weight: WEIGHTS.failureRate },
    { key: "disconnects", goodness: clamp01(1 - m.disconnectCount / DISCONNECTS_FULL_PENALTY_AT), weight: WEIGHTS.disconnects },
    { key: "capUsage", goodness: clamp01(1 - m.capUsagePct), weight: WEIGHTS.capUsage },
  ];

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const weighted = factors.reduce((s, f) => s + f.goodness * f.weight, 0);
  const score = Math.round((weighted / totalWeight) * 100);
  const risk: RiskLevel = score >= 70 ? "healthy" : score >= 40 ? "caution" : "at_risk";
  return { score, risk, factors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/health test`
Expected: PASS (all score tests).

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @evo/health typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/health/src/score.ts packages/health/src/score.test.ts
git commit -m "feat(health): weighted health score with risk levels and neutral sparse data"
```

---

## Task 5: Database models for health

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`

- [ ] **Step 1: Add enums and models to `schema.prisma`**

Append near the other model definitions (e.g. after the `Autoresponder` model):

```prisma
enum HealthRisk {
  healthy
  caution
  at_risk
}

enum HealthAlertKind {
  went_at_risk
  auto_protected
  ramp_cap_reached
}

model InstanceHealthPolicy {
  instanceId    String    @id
  workspaceId   String
  rampEnabled   Boolean   @default(false)
  rampStartedAt DateTime?
  rampBaseDaily Int       @default(20)
  rampGrowthPct Int       @default(15)
  rampMaxDaily  Int       @default(500)
  autoProtect   Boolean   @default(false)
  updatedAt     DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}

model InstanceHealthSnapshot {
  id          String     @id @default(cuid())
  workspaceId String
  instanceId  String
  date        DateTime   @db.Date
  score       Int
  risk        HealthRisk
  metrics     Json
  createdAt   DateTime   @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, date])
  @@index([workspaceId, date])
}

model HealthAlert {
  id             String          @id @default(cuid())
  workspaceId    String
  instanceId     String
  kind           HealthAlertKind
  detail         Json?
  acknowledgedAt DateTime?
  createdAt      DateTime        @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([instanceId, createdAt])
}
```

- [ ] **Step 2: Add back-relations to `Instance` and `Workspace` models**

In `model Instance`, add these relation fields (alongside `autoresponder`):

```prisma
  healthPolicy    InstanceHealthPolicy?
  healthSnapshots InstanceHealthSnapshot[]
  healthAlerts    HealthAlert[]
```

In `model Workspace`, add (alongside its other relation lists — find the block of `X[]` relations):

```prisma
  instanceHealthPolicies   InstanceHealthPolicy[]
  instanceHealthSnapshots  InstanceHealthSnapshot[]
  healthAlerts             HealthAlert[]
```

- [ ] **Step 3: Register new tenanted models in `packages/db/src/tenant.ts`**

Add to the `TENANTED_MODELS` set:

```typescript
  "InstanceHealthPolicy",
  "InstanceHealthSnapshot",
  "HealthAlert",
```

- [ ] **Step 4: Create the migration**

Run: `pnpm --filter @evo/db migrate:dev -- --name health_suite`
Expected: new migration folder under `packages/db/prisma/migrations/`, Prisma Client regenerated, no errors.

(If the interactive `--name` flag is rejected in this environment, run `node_modules/.bin/prisma migrate dev --name health_suite` from `packages/db` with `DATABASE_URL` set.)

- [ ] **Step 5: Verify client typecheck**

Run: `pnpm --filter @evo/db typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/tenant.ts
git commit -m "feat(db): health policy, snapshot, and alert models"
```

---

## Task 6: Send-path origin counting + ramp enforcement

**Files:**
- Modify: `packages/send/package.json`
- Modify: `packages/send/src/index.ts`
- Test: `packages/send/src/index.test.ts` (create)

- [ ] **Step 1: Add `@evo/health` dependency to `packages/send/package.json`**

In `dependencies`, add:

```json
    "@evo/health": "workspace:*",
```

Then run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `packages/send/src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    instance: { findUnique: vi.fn() },
    instanceHealthPolicy: { findUnique: vi.fn() },
  },
}));
vi.mock("@evo/queue", () => ({
  redis: vi.fn(),
  tokenBucket: () => ({ take: async () => ({ granted: true, waitedMs: 0, remaining: 9 }) }),
}));
vi.mock("@evo/evolution-client", () => ({
  EvolutionClient: class {},
  MessageApi: class {
    async sendPresence() {}
    async sendText() { return { key: { id: "m1" } }; }
    async sendMedia() { return { key: { id: "m2" } }; }
  },
}));

const { prisma } = await import("@evo/db");
const { redis } = await import("@evo/queue");
const { sendViaInstance, RampCapError } = await import("./index");

const mockInstance = { id: "i1", workspaceId: "w1", evolutionInstanceName: "evo", evolutionApiKey: "k" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVOLUTION_BASE_URL = "http://evo";
  (prisma.instance.findUnique as any).mockResolvedValue(mockInstance);
});

describe("sendViaInstance origin + ramp", () => {
  it("does not count or block conversational origins", async () => {
    (redis as any).mockReturnValue({ incr: vi.fn(), expire: vi.fn() });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({ rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date() });
    const r = await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "manual" });
    expect(r?.key?.id).toBe("m1");
    expect((redis as any)().incr).not.toHaveBeenCalled();
  });

  it("counts bulk origins and increments the counter", async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn();
    (redis as any).mockReturnValue({ incr, expire });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue(null); // no ramp
    await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" });
    expect(incr).toHaveBeenCalledOnce();
  });

  it("throws RampCapError when bulk cap is reached", async () => {
    const incr = vi.fn(); const expire = vi.fn();
    // get returns current count already at cap
    (redis as any).mockReturnValue({ incr, expire, get: vi.fn().mockResolvedValue("1") });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({
      rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date(),
    });
    await expect(
      sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" }),
    ).rejects.toBeInstanceOf(RampCapError);
    expect(incr).not.toHaveBeenCalled();
  });

  it("fails open (sends) if redis throws", async () => {
    (redis as any).mockReturnValue({ get: vi.fn().mockRejectedValue(new Error("down")), incr: vi.fn().mockRejectedValue(new Error("down")), expire: vi.fn() });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({ rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date() });
    const r = await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" });
    expect(r?.key?.id).toBe("m1");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @evo/send test`
Expected: FAIL — `RampCapError` / `opts` not implemented.

- [ ] **Step 4: Implement origin + ramp in `packages/send/src/index.ts`**

Replace the file with:

```typescript
import { prisma } from "@evo/db";
import { redis, tokenBucket } from "@evo/queue";
import { EvolutionClient, MessageApi } from "@evo/evolution-client";
import { rampCapForDay, daysSince, bulkSendKey } from "@evo/health";

const DEFAULT_BUCKET = { capacity: 10, refillPerSecond: 0.5 };
const WAIT_MS = 5 * 60 * 1000;
const COUNTER_TTL_SEC = 48 * 3600;

export type SendOrigin =
  | "broadcast" | "drip" | "inbound" | "followup"
  | "manual" | "chatbot" | "autoresponder" | "warmer";

const BULK_ORIGINS = new Set<SendOrigin>(["broadcast", "drip", "inbound", "followup"]);

export interface SendOptions {
  origin?: SendOrigin;
}

export class RampCapError extends Error {
  constructor(public instanceId: string, public cap: number) {
    super(`ramp cap reached for instance ${instanceId} (cap ${cap})`);
    this.name = "RampCapError";
  }
}

export interface SendTextPayload {
  type: "text";
  to: string;
  text: string;
  userId: string | null;
}

export interface SendMediaPayload {
  type: "media";
  to: string;
  mediaUrl: string;
  mediatype: "image" | "document" | "video" | "audio";
  mimetype?: string;
  caption?: string;
  fileName?: string;
  userId: string | null;
}

export type SendPayload = SendTextPayload | SendMediaPayload;

/** Returns remaining bulk allowance today for an instance, or null if unlimited (ramp off). */
export async function remainingBulkToday(instanceId: string, now = new Date()): Promise<number | null> {
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (!policy || !policy.rampEnabled || !policy.rampStartedAt) return null;
  const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
  try {
    const used = Number((await redis().get(bulkSendKey(instanceId, now))) ?? 0);
    return Math.max(0, cap - used);
  } catch {
    return null; // fail open
  }
}

async function enforceAndCountBulk(instanceId: string, now: Date): Promise<void> {
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (!policy || !policy.rampEnabled || !policy.rampStartedAt) {
    // Ramp off: still count usage for capUsage metric, but never block.
    try {
      const key = bulkSendKey(instanceId, now);
      await redis().incr(key);
      await redis().expire(key, COUNTER_TTL_SEC);
    } catch { /* fail open */ }
    return;
  }
  const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
  const key = bulkSendKey(instanceId, now);
  try {
    const used = Number((await redis().get(key)) ?? 0);
    if (used >= cap) throw new RampCapError(instanceId, cap);
    await redis().incr(key);
    await redis().expire(key, COUNTER_TTL_SEC);
  } catch (e) {
    if (e instanceof RampCapError) throw e;
    // redis failure -> fail open, do not block sends
  }
}

export async function sendViaInstance(
  instanceId: string,
  payload: SendPayload,
  opts: SendOptions = {},
) {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) throw new Error(`instance not found: ${instanceId}`);

  const origin = opts.origin ?? "manual";
  if (BULK_ORIGINS.has(origin)) {
    await enforceAndCountBulk(instanceId, new Date());
  }

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
  } catch {}

  if (payload.type === "text") {
    return api.sendText(instance.evolutionInstanceName, { number: payload.to, text: payload.text });
  }
  return api.sendMedia(instance.evolutionInstanceName, {
    number: payload.to,
    mediatype: payload.mediatype,
    media: payload.mediaUrl,
    mimetype: payload.mimetype,
    caption: payload.caption,
    fileName: payload.fileName,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @evo/send test`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @evo/send typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/send pnpm-lock.yaml
git commit -m "feat(send): origin tagging, ramp-cap enforcement, and daily bulk counter"
```

---

## Task 7: Pass `origin` at all bulk call sites

**Files:**
- Modify: `apps/worker/src/broadcast-send.ts` (origin `broadcast`)
- Modify: `apps/worker/src/drip-tick.ts` (origin `drip`)
- Modify: `apps/worker/src/follow-up-tick.ts` (origin `followup`)
- Modify: `apps/worker/src/inbound-send.ts` (origin `inbound`)
- Modify: `apps/worker/src/warmer-send.ts` (origin `warmer`)
- Modify: `apps/ingest/src/autoresponder.ts` (origin `autoresponder`)
- Modify: `apps/ingest/src/actions.ts` and `apps/ingest/src/automate.ts` (origin `chatbot`)

- [ ] **Step 1: `broadcast-send.ts`** — change the send call to:

```typescript
    const result = await sendViaInstance(instanceId, { type: "text", to, text, userId: null }, { origin: "broadcast" });
```

Also handle `RampCapError` by re-queuing the target. Import it and wrap:

```typescript
import { sendViaInstance, RampCapError } from "@evo/send";
```

In the `catch (err: any)` block, before marking failed:

```typescript
  } catch (err: any) {
    if (err instanceof RampCapError) {
      await prisma.broadcastTarget.update({ where: { id: targetId }, data: { status: "queued" } });
      return;
    }
    await prisma.broadcastTarget.update({
      where: { id: targetId },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
  }
```

- [ ] **Step 2: `drip-tick.ts`** — change the send call (line ~40) to add `, { origin: "drip" }` as the third argument.

- [ ] **Step 3: `follow-up-tick.ts`** — change the send call (line ~30) to add `, { origin: "followup" }`.

- [ ] **Step 4: `inbound-send.ts`** — change the send call (line ~16) to add `, { origin: "inbound" }`.

- [ ] **Step 5: `warmer-send.ts`** — change the send call (line ~17) to add `, { origin: "warmer" }`.

- [ ] **Step 6: `autoresponder.ts`** — change the send call (line ~51) to add `, { origin: "autoresponder" }`.

- [ ] **Step 7: `actions.ts` and `automate.ts`** — add `, { origin: "chatbot" }` to each `sendViaInstance(...)` call in those files (3 in actions.ts, 2 in automate.ts).

- [ ] **Step 8: Run affected test suites**

Run: `pnpm --filter @evo/worker test && pnpm --filter @evo/ingest test`
Expected: PASS. (Existing tests mock `@evo/send`, so the extra arg is ignored; broadcast-send test still passes because `RampCapError` is only thrown by the real module.)

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @evo/worker typecheck && pnpm --filter @evo/ingest typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/worker/src apps/ingest/src
git commit -m "feat(send): tag every send call site with its origin; requeue on ramp cap"
```

---

## Task 8: Health metrics aggregation (worker helper)

**Files:**
- Create: `apps/worker/src/health-metrics.ts`
- Modify: `apps/worker/package.json` (add `@evo/health` dep)
- Test: `apps/worker/src/health-metrics.test.ts`

- [ ] **Step 1: Add `@evo/health` to `apps/worker/package.json` dependencies**

```json
    "@evo/health": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test** (uses real test Postgres, like other worker tests)

Create `apps/worker/src/health-metrics.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
const { prisma } = await import("@evo/db");
const { collectMetrics } = await import("./health-metrics");

let workspaceId: string;
let instanceId: string;

async function reset() {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.broadcastTarget.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "H", slug: "h-" + Date.now() } });
  workspaceId = ws.id;
  const inst = await prisma.instance.create({
    data: { workspaceId, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  instanceId = inst.id;
});

describe("collectMetrics", () => {
  it("computes reply ratio from conversations with inbound vs outbound-only", async () => {
    // conv A: outbound + inbound (replied)
    const a = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "601" } });
    await prisma.message.create({ data: { workspaceId, conversationId: a.id, direction: "outbound", type: "text", body: "hi" } });
    await prisma.message.create({ data: { workspaceId, conversationId: a.id, direction: "inbound", type: "text", body: "yo" } });
    // conv B: outbound only (no reply)
    const b = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "602" } });
    await prisma.message.create({ data: { workspaceId, conversationId: b.id, direction: "outbound", type: "text", body: "hi" } });

    const m = await collectMetrics(instanceId, workspaceId, new Date());
    expect(m.businessInitiatedConversations).toBe(2);
    expect(m.replyRatio).toBeCloseTo(0.5, 5);
    expect(m.outboundOnlyConversationPct).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @evo/worker test -- health-metrics`
Expected: FAIL — cannot find `./health-metrics`.

- [ ] **Step 4: Implement `apps/worker/src/health-metrics.ts`**

```typescript
import { prisma } from "@evo/db";
import { rampCapForDay, daysSince, bulkSendKey, type HealthMetrics } from "@evo/health";
import { redis } from "@evo/queue";

const WINDOW_DAYS = 7;

export async function collectMetrics(
  instanceId: string,
  workspaceId: string,
  now: Date,
): Promise<HealthMetrics> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  // Business-initiated conversations: have >=1 outbound in the window.
  const convs = await prisma.conversation.findMany({
    where: { instanceId, messages: { some: { direction: "outbound", sentAt: { gte: since } } } },
    select: {
      id: true,
      messages: { where: { sentAt: { gte: since } }, select: { direction: true } },
    },
  });
  const businessInitiated = convs.length;
  let replied = 0;
  let outboundOnly = 0;
  for (const c of convs) {
    const hasInbound = c.messages.some((m) => m.direction === "inbound");
    if (hasInbound) replied += 1;
    else outboundOnly += 1;
  }
  const replyRatio = businessInitiated > 0 ? replied / businessInitiated : 0;
  const outboundOnlyConversationPct = businessInitiated > 0 ? outboundOnly / businessInitiated : 0;

  // Failure rate over broadcast targets in the window.
  const attempted = await prisma.broadcastTarget.count({
    where: { workspaceId, sentAt: { gte: since }, broadcast: { instanceId } },
  });
  const failed = await prisma.broadcastTarget.count({
    where: { workspaceId, status: "failed", broadcast: { instanceId } },
  });
  const failureRate = attempted + failed > 0 ? failed / (attempted + failed) : 0;

  // capUsagePct from today's counter vs today's ramp cap.
  let capUsagePct = 0;
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (policy?.rampEnabled && policy.rampStartedAt) {
    const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
    try {
      const used = Number((await redis().get(bulkSendKey(instanceId, now))) ?? 0);
      capUsagePct = cap > 0 ? Math.min(1, used / cap) : 0;
    } catch { capUsagePct = 0; }
  }

  return {
    businessInitiatedConversations: businessInitiated,
    replyRatio,
    failureRate,
    outboundOnlyConversationPct,
    disconnectCount: 0, // populated by the tick from state transitions; 0 baseline here
    capUsagePct,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @evo/worker test -- health-metrics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/health-metrics.ts apps/worker/src/health-metrics.test.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): health metrics aggregation from messages and broadcast targets"
```

---

## Task 9: `health-tick` — snapshot + alerting + auto-protect

**Files:**
- Create: `apps/worker/src/health-tick.ts`
- Test: `apps/worker/src/health-tick.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/health-tick.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
const { prisma } = await import("@evo/db");
const { runHealthTick } = await import("./health-tick");

let workspaceId: string;
let instanceId: string;

async function reset() {
  await prisma.healthAlert.deleteMany();
  await prisma.instanceHealthSnapshot.deleteMany();
  await prisma.instanceHealthPolicy.deleteMany();
  await prisma.broadcastTarget.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

async function seedSpammy() {
  const ws = await prisma.workspace.create({ data: { name: "H", slug: "h-" + Date.now() } });
  workspaceId = ws.id;
  const inst = await prisma.instance.create({
    data: { workspaceId, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  instanceId = inst.id;
  // 15 outbound-only conversations => reply ratio 0, sufficient data, at_risk
  for (let i = 0; i < 15; i++) {
    const c = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "60" + i } });
    await prisma.message.create({ data: { workspaceId, conversationId: c.id, direction: "outbound", type: "text", body: "hi" } });
  }
}

beforeEach(async () => {
  await reset();
  await seedSpammy();
});

describe("runHealthTick", () => {
  it("writes a snapshot and raises a went_at_risk alert", async () => {
    const r = await runHealthTick({ now: new Date() });
    expect(r.snapshotted).toBeGreaterThanOrEqual(1);
    const snap = await prisma.instanceHealthSnapshot.findFirst({ where: { instanceId } });
    expect(snap?.risk).toBe("at_risk");
    const alert = await prisma.healthAlert.findFirst({ where: { instanceId, kind: "went_at_risk" } });
    expect(alert).not.toBeNull();
  });

  it("does not duplicate the went_at_risk alert on a second tick same risk", async () => {
    await runHealthTick({ now: new Date() });
    await runHealthTick({ now: new Date() });
    const count = await prisma.healthAlert.count({ where: { instanceId, kind: "went_at_risk" } });
    expect(count).toBe(1);
  });

  it("auto-protects running broadcasts when policy.autoProtect is on", async () => {
    await prisma.instanceHealthPolicy.create({
      data: { instanceId, workspaceId, autoProtect: true },
    });
    const list = await prisma.contactList.create({ data: { workspaceId, name: "L" } });
    const b = await prisma.broadcast.create({
      data: { workspaceId, instanceId, listId: list.id, name: "B", status: "running", createdByUserId: "u" } as any,
    });
    await runHealthTick({ now: new Date() });
    const after = await prisma.broadcast.findUnique({ where: { id: b.id } });
    expect(after?.status).toBe("paused");
    const alert = await prisma.healthAlert.findFirst({ where: { instanceId, kind: "auto_protected" } });
    expect(alert).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @evo/worker test -- health-tick`
Expected: FAIL — cannot find `./health-tick`.

- [ ] **Step 3: Implement `apps/worker/src/health-tick.ts`**

```typescript
import { prisma } from "@evo/db";
import { computeHealthScore, type RiskLevel } from "@evo/health";
import { utcDateStamp } from "@evo/health";
import { collectMetrics } from "./health-metrics.js";

/** Truncate to UTC midnight so @db.Date upserts are stable. */
function utcDate(now: Date): Date {
  return new Date(utcDateStamp(now) + "T00:00:00.000Z");
}

async function previousRisk(instanceId: string, today: Date): Promise<RiskLevel | null> {
  const prev = await prisma.instanceHealthSnapshot.findFirst({
    where: { instanceId, date: { lt: today } },
    orderBy: { date: "desc" },
    select: { risk: true },
  });
  return (prev?.risk as RiskLevel) ?? null;
}

export async function runHealthTick(opts?: { now?: Date }): Promise<{ snapshotted: number }> {
  const now = opts?.now ?? new Date();
  const today = utcDate(now);
  const instances = await prisma.instance.findMany({ select: { id: true, workspaceId: true } });

  let snapshotted = 0;
  for (const inst of instances) {
    const metrics = await collectMetrics(inst.id, inst.workspaceId, now);
    const { score, risk } = computeHealthScore(metrics);

    const prior = await previousRisk(inst.id, today);
    const existingToday = await prisma.instanceHealthSnapshot.findUnique({
      where: { instanceId_date: { instanceId: inst.id, date: today } },
      select: { risk: true },
    });
    const priorRisk = (existingToday?.risk as RiskLevel) ?? prior;

    await prisma.instanceHealthSnapshot.upsert({
      where: { instanceId_date: { instanceId: inst.id, date: today } },
      create: { workspaceId: inst.workspaceId, instanceId: inst.id, date: today, score, risk, metrics: metrics as any },
      update: { score, risk, metrics: metrics as any },
    });
    snapshotted += 1;

    // Alert only on transition INTO at_risk.
    if (risk === "at_risk" && priorRisk !== "at_risk") {
      await prisma.healthAlert.create({
        data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { score } as any },
      });

      const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
      if (policy?.autoProtect) {
        const paused = await prisma.broadcast.updateMany({
          where: { instanceId: inst.id, status: "running" },
          data: { status: "paused" },
        });
        if (paused.count > 0) {
          await prisma.healthAlert.create({
            data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "auto_protected", detail: { pausedBroadcasts: paused.count } as any },
          });
        }
      }
    }
  }
  return { snapshotted };
}
```

Note: `BroadcastStatus` includes `paused` (confirmed in the schema). The `instanceHealthSnapshot` unique selector uses Prisma's compound-unique name `instanceId_date`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @evo/worker test -- health-tick`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/health-tick.ts apps/worker/src/health-tick.test.ts
git commit -m "feat(worker): health-tick snapshots scores, alerts at-risk, auto-protects broadcasts"
```

---

## Task 10: Register `health-tick` in the worker and pre-check scheduler allowance

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/broadcast-scheduler.ts`

- [ ] **Step 1: Register the tick in `apps/worker/src/index.ts`**

Add the import near the other tick imports:

```typescript
import { runHealthTick } from "./health-tick.js";
```

Add after the warmer worker registration block (before the inbound-send worker):

```typescript
const HEALTH_TICK_QUEUE = "health-tick";
const healthTickQueue = new Queue(HEALTH_TICK_QUEUE, { connection });
await healthTickQueue.add("tick", {}, { repeat: { every: 900000 }, jobId: "health-tick:repeat" });
new Worker(HEALTH_TICK_QUEUE, async () => {
  const { snapshotted } = await runHealthTick();
  if (snapshotted > 0) log.info({ snapshotted }, "health tick");
}, { connection });
```

- [ ] **Step 2: Pre-check allowance in `apps/worker/src/broadcast-scheduler.ts`**

Import at top:

```typescript
import { remainingBulkToday } from "@evo/send";
```

Inside the per-broadcast loop, after the `isWithinSchedule` check and before fetching targets, cap the batch to remaining allowance:

```typescript
    const allowance = await remainingBulkToday(b.instanceId, now);
    if (allowance !== null && allowance <= 0) continue; // ramp exhausted today; defer
    const take = allowance === null ? BATCH_SIZE : Math.min(BATCH_SIZE, allowance);

    const targets = await prisma.broadcastTarget.findMany({
      where: { broadcastId: b.id, status: "queued" },
      take,
      include: { contact: true },
    });
```

(Replace the existing `take: BATCH_SIZE` in that `findMany`.)

`packages/send` is already a worker dependency, so no package.json change is needed.

- [ ] **Step 3: Run scheduler tests + typecheck**

Run: `pnpm --filter @evo/worker test -- broadcast-scheduler && pnpm --filter @evo/worker typecheck`
Expected: PASS, no type errors. (The scheduler test doesn't set a ramp policy, so `remainingBulkToday` returns `null` and behaviour is unchanged.)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/broadcast-scheduler.ts
git commit -m "feat(worker): run health-tick every 15m; cap broadcast batch to ramp allowance"
```

---

## Task 11: Health API routes

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/health/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/policy/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/health/alerts/[id]/ack/route.ts`

- [ ] **Step 1: `GET /health` — overview**

Create `apps/web/src/app/api/workspaces/[slug]/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { remainingBulkToday } from "@evo/send";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instances = await db.instance.findMany({
      select: { id: true, label: true, phoneNumber: true, connectionState: true },
      orderBy: { label: "asc" },
    });
    const today = new Date();
    const rows = await Promise.all(
      instances.map(async (inst) => {
        const snapshot = await db.instanceHealthSnapshot.findFirst({
          where: { instanceId: inst.id },
          orderBy: { date: "desc" },
        });
        const policy = await db.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
        const remaining = await remainingBulkToday(inst.id, today);
        const openAlerts = await db.healthAlert.count({ where: { instanceId: inst.id, acknowledgedAt: null } });
        return { instance: inst, snapshot, policy, remainingBulkToday: remaining, openAlerts };
      }),
    );
    return NextResponse.json({ instances: rows });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: `GET /health/instances/[id]` — history + alerts**

Create `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const snapshots = await db.instanceHealthSnapshot.findMany({
      where: { instanceId: id },
      orderBy: { date: "desc" },
      take: 14,
    });
    const alerts = await db.healthAlert.findMany({
      where: { instanceId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ snapshots, alerts });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: `PUT /health/instances/[id]/policy` — upsert policy (Admin)**

Create `apps/web/src/app/api/workspaces/[slug]/health/instances/[id]/policy/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const schema = z.object({
  rampEnabled: z.boolean(),
  rampBaseDaily: z.number().int().min(1).max(100000),
  rampGrowthPct: z.number().int().min(0).max(100),
  rampMaxDaily: z.number().int().min(1).max(1000000),
  autoProtect: z.boolean(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.instanceHealthPolicy.findUnique({ where: { instanceId: id } });
    // Start the ramp clock the first time it is enabled.
    const rampStartedAt =
      parsed.data.rampEnabled && !existing?.rampStartedAt ? new Date() : existing?.rampStartedAt ?? null;
    const policy = await db.instanceHealthPolicy.upsert({
      where: { instanceId: id },
      create: { instanceId: id, ...parsed.data, rampStartedAt } as any,
      update: { ...parsed.data, rampStartedAt } as any,
    });
    return NextResponse.json({ policy });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: `POST /health/alerts/[id]/ack` — acknowledge (Agent)**

Create `apps/web/src/app/api/workspaces/[slug]/health/alerts/[id]/ack/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    await db.healthAlert.updateMany({ where: { id }, data: { acknowledgedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter @evo/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/workspaces/\[slug\]/health
git commit -m "feat(web): health API routes (overview, history, policy, ack)"
```

---

## Task 12: Health dashboard page + nav + i18n

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/health/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/health/health-client.tsx`
- Modify: `apps/web/src/components/shell/sidebar.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx`
- Modify: `apps/web/messages/en-GB.json`

- [ ] **Step 1: Add i18n keys to `apps/web/messages/en-GB.json`**

In the `"nav"` object add:

```json
    "health": "Number Health",
```

Add a top-level `"health"` block (sibling of `"analytics"`):

```json
  "health": {
    "title": "Number Health",
    "subtitle": "Account reputation, warm-up ramps, and ban-risk protection per number.",
    "score": "Health score",
    "risk": "Risk",
    "healthy": "Healthy",
    "caution": "Caution",
    "atRisk": "At risk",
    "gatheringData": "Gathering data",
    "todayUsage": "Today's bulk sends",
    "cap": "Daily cap",
    "unlimited": "Unlimited",
    "factors": "Factors",
    "replyRatio": "Reply ratio",
    "outboundOnly": "One-way conversations",
    "failureRate": "Send failure rate",
    "disconnects": "Disconnections",
    "capUsage": "Cap usage",
    "policy": "Warm-up & protection",
    "rampEnabled": "Enable warm-up ramp",
    "rampBaseDaily": "Starting daily cap",
    "rampGrowthPct": "Daily growth %",
    "rampMaxDaily": "Maximum daily cap",
    "autoProtect": "Auto-pause broadcasts when at risk",
    "save": "Save",
    "saved": "Saved",
    "alerts": "Alerts",
    "acknowledge": "Acknowledge",
    "noAlerts": "No alerts",
    "improveHint": "Low reply ratio hurts this score. Run the Warmer to build reputation.",
    "empty": "No instances yet. Connect a number to see its health."
  },
```

- [ ] **Step 2: Add the nav item in `apps/web/src/components/shell/sidebar.tsx`**

Add `HeartPulse` to the lucide import list, then add this item right after the `warmer` item:

```typescript
    { href: `${base}/health`, label: labels.health, icon: HeartPulse },
```

- [ ] **Step 3: Add the `health` label in `apps/web/src/app/[workspaceSlug]/layout.tsx`**

In the `labels` object, add:

```typescript
    health: t("nav.health"),
```

- [ ] **Step 4: Create the client component `health-client.tsx`**

```typescript
"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

interface Policy {
  rampEnabled: boolean;
  rampBaseDaily: number;
  rampGrowthPct: number;
  rampMaxDaily: number;
  autoProtect: boolean;
}

export function PolicyEditor({
  workspaceSlug, instanceId, initial, canEdit,
}: { workspaceSlug: string; instanceId: string; initial: Policy; canEdit: boolean }) {
  const t = useTranslations("health");
  const [p, setP] = useState<Policy>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setSaved(false);
    await fetch(`/api/workspaces/${workspaceSlug}/health/instances/${instanceId}/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    setBusy(false); setSaved(true);
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!canEdit} checked={p.rampEnabled}
          onChange={(e) => setP({ ...p, rampEnabled: e.target.checked })} />
        {t("rampEnabled")}
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampBaseDaily")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampBaseDaily} onChange={(e) => setP({ ...p, rampBaseDaily: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampGrowthPct")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampGrowthPct} onChange={(e) => setP({ ...p, rampGrowthPct: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampMaxDaily")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampMaxDaily} onChange={(e) => setP({ ...p, rampMaxDaily: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!canEdit} checked={p.autoProtect}
          onChange={(e) => setP({ ...p, autoProtect: e.target.checked })} />
        {t("autoProtect")}
      </label>
      {canEdit && (
        <button onClick={save} disabled={busy}
          className="bg-primary text-primary-foreground rounded px-3 py-1.5 disabled:opacity-50">
          {saved ? t("saved") : t("save")}
        </button>
      )}
    </div>
  );
}

export function AckButton({ workspaceSlug, alertId }: { workspaceSlug: string; alertId: string }) {
  const t = useTranslations("health");
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await fetch(`/api/workspaces/${workspaceSlug}/health/alerts/${alertId}/ack`, { method: "POST" });
        setDone(true);
      }}
      disabled={done}
      className="text-xs underline disabled:opacity-40"
    >
      {t("acknowledge")}
    </button>
  );
}
```

- [ ] **Step 5: Create the page `page.tsx`**

```typescript
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { remainingBulkToday } from "@evo/send";
import { computeHealthScore, type HealthMetrics } from "@evo/health";
import { PolicyEditor, AckButton } from "./health-client";

const DEFAULT_POLICY = { rampEnabled: false, rampBaseDaily: 20, rampGrowthPct: 15, rampMaxDaily: 500, autoProtect: false };

function riskLabel(t: (k: string) => string, risk: string): string {
  return risk === "healthy" ? t("healthy") : risk === "caution" ? t("caution") : t("atRisk");
}

export default async function HealthPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("health");
  const db = tenantClient(workspace.id);
  const canEdit = role === "Admin" || role === "Owner";

  const instances = await db.instance.findMany({ orderBy: { label: "asc" } });

  const cards = await Promise.all(instances.map(async (inst) => {
    const snapshot = await db.instanceHealthSnapshot.findFirst({
      where: { instanceId: inst.id }, orderBy: { date: "desc" },
    });
    const policy = await db.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
    const remaining = await remainingBulkToday(inst.id, new Date());
    const alerts = await db.healthAlert.findMany({
      where: { instanceId: inst.id, acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 10,
    });
    const metrics = (snapshot?.metrics as unknown as HealthMetrics | undefined) ?? null;
    const factors = metrics ? computeHealthScore(metrics).factors : [];
    return { inst, snapshot, policy, remaining, alerts, factors, metrics };
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      {cards.length === 0 && <p className="text-muted-foreground text-sm">{t("empty")}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ inst, snapshot, policy, remaining, alerts, factors, metrics }) => (
          <div key={inst.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <strong>{inst.label}</strong>
                <div className="text-xs text-muted-foreground">{inst.phoneNumber ?? "—"}</div>
              </div>
              <div className="text-right">
                {snapshot ? (
                  <>
                    <div className="text-2xl font-semibold">{snapshot.score}</div>
                    <div className="text-xs">{riskLabel(t, snapshot.risk)}</div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">{t("gatheringData")}</div>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {t("todayUsage")}: {policy?.rampEnabled && remaining !== null
                ? `${t("cap")} − ${remaining} ${t("unlimited") === "" ? "" : ""}`.trim()
                : t("unlimited")}
            </div>

            {factors.length > 0 && (
              <ul className="text-xs space-y-1">
                {factors.map((f) => (
                  <li key={f.key} className="flex justify-between">
                    <span>{t(f.key)}</span>
                    <span className="text-muted-foreground">
                      {f.insufficientData ? t("gatheringData") : `${Math.round(f.goodness * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {metrics && metrics.businessInitiatedConversations >= 10 && metrics.replyRatio < 0.1 && (
              <p className="text-xs text-amber-600">{t("improveHint")}</p>
            )}

            {alerts.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium">{t("alerts")}</div>
                {alerts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span>{a.kind}</span>
                    <AckButton workspaceSlug={workspaceSlug} alertId={a.id} />
                  </div>
                ))}
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer">{t("policy")}</summary>
              <div className="pt-2">
                <PolicyEditor
                  workspaceSlug={workspaceSlug}
                  instanceId={inst.id}
                  canEdit={canEdit}
                  initial={{
                    rampEnabled: policy?.rampEnabled ?? DEFAULT_POLICY.rampEnabled,
                    rampBaseDaily: policy?.rampBaseDaily ?? DEFAULT_POLICY.rampBaseDaily,
                    rampGrowthPct: policy?.rampGrowthPct ?? DEFAULT_POLICY.rampGrowthPct,
                    rampMaxDaily: policy?.rampMaxDaily ?? DEFAULT_POLICY.rampMaxDaily,
                    autoProtect: policy?.autoProtect ?? DEFAULT_POLICY.autoProtect,
                  }}
                />
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck the web app**

Run: `pnpm --filter @evo/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\[workspaceSlug\]/health apps/web/src/components/shell/sidebar.tsx apps/web/src/app/\[workspaceSlug\]/layout.tsx apps/web/messages/en-GB.json
git commit -m "feat(web): Number Health dashboard, policy editor, nav, and i18n"
```

---

## Task 13: Health webhook event kinds

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[slug]/webhook-subscriptions/route.ts`
- Modify: `apps/worker/src/health-tick.ts`

- [ ] **Step 1: Add event kinds to `VALID_EVENTS`**

In `webhook-subscriptions/route.ts`, extend the array:

```typescript
const VALID_EVENTS = [
  "message.received",
  "message.sent",
  "message.status",
  "instance.state",
  "broadcast.completed",
  "broadcast.failed",
  "health.at_risk",
  "health.auto_protected",
  "health.ramp_cap_reached",
];
```

- [ ] **Step 2: Emit webhook deliveries from `health-tick.ts`**

First check how webhooks are delivered elsewhere. Run:

```bash
grep -rn "webhookSubscription\|webhook.*fetch\|events.*includes" apps/worker/src apps/ingest/src
```

If a delivery helper exists, call it. If NOT (webhooks are configured in the UI but no dispatcher ships yet), add a minimal inline dispatch inside the at-risk branch of `runHealthTick`, right after creating the `went_at_risk` alert:

```typescript
      const subs = await prisma.webhookSubscription.findMany({
        where: { workspaceId: inst.workspaceId, enabled: true },
      });
      for (const sub of subs) {
        const events = Array.isArray(sub.events) ? (sub.events as string[]) : [];
        if (!events.includes("health.at_risk")) continue;
        try {
          await fetch(sub.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: "health.at_risk", instanceId: inst.id, score, at: now.toISOString() }),
          });
        } catch { /* delivery is best-effort */ }
      }
```

Do the same emission for `health.auto_protected` inside the `autoProtect` branch (event name `health.auto_protected`, include `pausedBroadcasts`).

- [ ] **Step 3: Run health-tick tests (should still pass; no subs seeded)**

Run: `pnpm --filter @evo/worker test -- health-tick`
Expected: PASS. (`fetch` is never called because no subscriptions exist in the test DB.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @evo/worker typecheck && pnpm --filter @evo/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/workspaces/\[slug\]/webhook-subscriptions/route.ts apps/worker/src/health-tick.ts
git commit -m "feat(health): emit health.at_risk and health.auto_protected webhook events"
```

---

## Task 14: Full verification pass

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: all packages pass (health, send, worker, ingest, web units, etc.).

- [ ] **Step 2: Typecheck everything**

Run: `pnpm -r typecheck`
Expected: no errors across the monorepo.

- [ ] **Step 3: Build web to catch RSC/client boundary issues**

Run: `pnpm --filter @evo/web build`
Expected: build succeeds; `/[workspaceSlug]/health` compiles.

- [ ] **Step 4: Manual smoke (optional, requires stack up)**

Bring up Postgres/Redis, `pnpm --filter @evo/db migrate`, `pnpm dev`. Visit `/<workspace>/health`, confirm the page renders with instance cards, toggle the ramp on, save, confirm the policy persists.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore(health): verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** score (Task 4), ramp (Task 2), Redis counter/enforcement (Tasks 3, 6), data model (Task 5), send-path origins (Tasks 6–7), health-tick + auto-protect (Tasks 9–10), scheduler allowance (Task 10), API (Task 11), dashboard/nav/i18n (Task 12), webhook events (Task 13). All spec sections mapped.
- **Types consistent:** `HealthMetrics`, `RiskLevel`, `Factor`, `RampPolicy`, `SendOrigin`, `RampCapError`, `remainingBulkToday`, `collectMetrics`, `runHealthTick` used with identical signatures across tasks.
- **Assumption to verify during Task 5:** `BroadcastStatus` enum includes `paused` — confirmed present in schema (used by Task 9/10). If a `WorkspaceIntegration`/other model relation block differs, follow the existing pattern when adding back-relations.
- **Assumption to verify during Task 13:** whether an outbound-webhook dispatcher already exists. The grep step decides inline-dispatch vs reuse; no duplicate dispatcher is introduced if one exists.
