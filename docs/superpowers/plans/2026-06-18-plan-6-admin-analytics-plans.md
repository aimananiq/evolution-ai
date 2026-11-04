# Plan 6 — Admin + analytics + plan limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plan-based usage caps that the API enforces at write time, give super-admins a workspace/user/plan/health console, and surface workspace-level analytics for messages, broadcasts, and warmer activity.

**Architecture:** Add a `Plan` table with feature flags + caps and a `WorkspacePlan` join row that records which plan a workspace is on. A new `@evo/limits` helper resolves the current plan + checks caps before mutating routes (contacts, instances, monthly message count). A `User.isSuperAdmin` boolean lets a subset of users access `/admin/*` pages that query across workspaces (read-only for v1). Analytics screens are server-rendered Postgres aggregations — no new tables, no ClickHouse-style separate analytics store. Three plans seeded: `free`, `pro`, `enterprise`. The remaining spec sections — groups UI, pass-through integration configurators (Chatwoot/Typebot/RabbitMQ/SQS/Kafka/Pusher), audit log viewer, webhook subscriptions, and API-key management — are explicitly deferred to a Plan 6.5; this plan focuses on the foundation pieces so caps + admin + analytics can ship.

**Tech Stack:** Inherits Plans 0–5. Adds: `recharts ^2.13.x` for analytics charts (lightweight, no D3 ramp-up).

**Definition of done:**
1. Three plans seeded (`free`, `pro`, `enterprise`) with sensible caps + featureFlags JSON.
2. Every workspace has a `WorkspacePlan` row on creation (defaulting to `free`).
3. Creating a contact, creating an instance, or sending any message routes through `@evo/limits.requireUnder(workspaceId, kind)` which returns `{ allowed, used, cap }` and lets the route 429 / 402 / show a friendly error when the cap is reached.
4. A super-admin user can visit `/admin/workspaces`, `/admin/users`, `/admin/plans`, `/admin/health` to view aggregate state across workspaces.
5. `/[workspaceSlug]/analytics` shows: messages per day (line chart), broadcast funnel (sent/delivered/read/failed bars), warmer activity (events per day).
6. All previous tests pass; new tests added: `@evo/limits` 5+, plan enforcement on contacts route 2+, plan enforcement on instances route 2+.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — section 1 (Plan / WorkspacePlan tables), section 2 (Settings → Plan, Admin screens, Analytics), section 6 (plan enforcement env flag).

---

## File structure produced by this plan

```
/
├─ packages/
│  ├─ db/prisma/schema.prisma                                       # MODIFIED: + Plan, WorkspacePlan + isSuperAdmin
│  ├─ db/prisma/migrations/<ts>_plans/migration.sql                 # NEW
│  ├─ db/prisma/seed.ts                                             # MODIFIED: also seed plans + assign default
│  ├─ db/src/tenant.ts                                              # MODIFIED: + WorkspacePlan
│  └─ limits/                                                       # NEW package
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts                                                # requireUnder + helpers
│        └─ index.test.ts
├─ apps/web/
│  ├─ package.json                                                  # MODIFIED: recharts dep
│  ├─ messages/en-GB.json                                           # MODIFIED: plan.* admin.* analytics.*
│  └─ src/
│     ├─ lib/super-admin.ts                                         # NEW: requireSuperAdmin guard
│     ├─ app/
│     │  ├─ api/
│     │  │  ├─ workspaces/[slug]/plan/route.ts                      # GET workspace plan + usage
│     │  │  └─ admin/
│     │  │     ├─ workspaces/route.ts                               # GET all workspaces (super-admin only)
│     │  │     ├─ users/route.ts                                    # GET all users
│     │  │     ├─ plans/route.ts                                    # GET all plans + POST upsert
│     │  │     └─ health/route.ts                                   # GET queue depth, instance counts, etc.
│     │  ├─ admin/
│     │  │  ├─ layout.tsx                                           # super-admin shell
│     │  │  ├─ page.tsx                                             # redirect to /admin/workspaces
│     │  │  ├─ workspaces/page.tsx
│     │  │  ├─ users/page.tsx
│     │  │  ├─ plans/page.tsx
│     │  │  ├─ plans/plans-editor.tsx                               # client
│     │  │  └─ health/page.tsx
│     │  └─ [workspaceSlug]/
│     │     ├─ settings/plan/page.tsx                               # workspace-scoped plan view
│     │     └─ analytics/
│     │        ├─ page.tsx                                          # redirect to /analytics/messages
│     │        ├─ messages/page.tsx                                 # server-rendered chart
│     │        ├─ messages/messages-chart.tsx                       # client (recharts)
│     │        ├─ broadcasts/page.tsx
│     │        ├─ broadcasts/broadcasts-chart.tsx
│     │        └─ warmer/page.tsx
│     │        └─ warmer/warmer-chart.tsx
└─ apps/web/src/app/api/workspaces/[slug]/
   ├─ contacts/route.ts                                             # MODIFIED: enforce contactCap
   ├─ instances/route.ts                                            # MODIFIED: enforce instanceCap
   └─ broadcasts/[id]/start/route.ts                                # MODIFIED: enforce monthlyMessageCap
```

Note: `@evo/send.sendViaInstance` could also enforce monthly cap, but enforcing at broadcast-start (rather than per-message) avoids the bucket waiting + race with cap depletion. Per-message cap enforcement is a Plan 6.5 follow-up.

---

### Task 1: Schema — Plan, WorkspacePlan, User.isSuperAdmin

**Files:** modify schema, new migration, modify tenant.

- [ ] **Step 1: Append to schema.prisma** (after WarmerEvent):

```prisma
enum PlanKind {
  free
  pro
  enterprise
  custom
}

model Plan {
  id                String   @id @default(cuid())
  kind              PlanKind @unique
  name              String
  description       String
  contactCap        Int
  instanceCap       Int
  monthlyMessageCap Int
  featureFlags      Json
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  workspaces WorkspacePlan[]
}

model WorkspacePlan {
  workspaceId String    @id
  planId      String
  since       DateTime  @default(now())
  until       DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  plan      Plan      @relation(fields: [planId], references: [id])

  @@index([planId])
}
```

Add to existing `User` model:

```prisma
  isSuperAdmin Boolean @default(false)
```

Add to existing `Workspace` model:

```prisma
  plan WorkspacePlan?
```

- [ ] **Step 2: Generate migration**

```bash
pnpm --filter @evo/db exec prisma migrate dev --name plans
```

(Docker-network workaround if host conflict.)

- [ ] **Step 3: Extend tenant scope**

In `packages/db/src/tenant.ts`, add ONE new entry:

```typescript
  "WorkspacePlan",
```

(Don't add `Plan` — it's a global table.)

TENANTED_MODELS should now have 24 entries.

- [ ] **Step 4: Update seed.ts**

Read the current `packages/db/prisma/seed.ts` (which seeds WarmerPresets from Plan 5). Append plan seeding INSIDE the same `main()` function:

```typescript
const PLANS = [
  {
    kind: "free" as const,
    name: "Free",
    description: "Try it out — limited usage.",
    contactCap: 200,
    instanceCap: 1,
    monthlyMessageCap: 1000,
    featureFlags: { warmer: false, aiChatbot: false },
  },
  {
    kind: "pro" as const,
    name: "Pro",
    description: "Small teams, up to 5 numbers.",
    contactCap: 10000,
    instanceCap: 5,
    monthlyMessageCap: 50000,
    featureFlags: { warmer: true, aiChatbot: true },
  },
  {
    kind: "enterprise" as const,
    name: "Enterprise",
    description: "Unlimited usage; private servers.",
    contactCap: 1000000,
    instanceCap: 100,
    monthlyMessageCap: 10000000,
    featureFlags: { warmer: true, aiChatbot: true, multiTenantWorkspaceCount: 100 },
  },
];

// Append inside main() after preset seeding:
for (const plan of PLANS) {
  await prisma.plan.upsert({
    where: { kind: plan.kind },
    create: plan as any,
    update: { name: plan.name, description: plan.description, contactCap: plan.contactCap, instanceCap: plan.instanceCap, monthlyMessageCap: plan.monthlyMessageCap, featureFlags: plan.featureFlags as any },
  });
}
console.log(`seeded ${PLANS.length} plans`);
```

- [ ] **Step 5: Auto-assign default plan on workspace creation**

In `apps/web/src/app/api/workspaces/route.ts` (the POST handler from Plan 0), after `prisma.workspace.create(...)`, add:

```typescript
    // Assign the free plan by default
    const freePlan = await prisma.plan.findUnique({ where: { kind: "free" } });
    if (freePlan) {
      await prisma.workspacePlan.create({
        data: { workspaceId: workspace.id, planId: freePlan.id },
      });
    }
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @evo/db generate
DATABASE_URL="postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public" \
  pnpm --filter @evo/db exec prisma migrate deploy
pnpm --filter @evo/db exec prisma db seed
pnpm --filter @evo/db test
pnpm --filter @evo/web typecheck
```

Expected: typecheck PASS; 3/3 db tests still pass; 3 rows in Plan table.

```bash
git add packages/db apps/web/src/app/api/workspaces/route.ts
git commit -m "feat(db): Plan + WorkspacePlan tables, isSuperAdmin flag, auto-assign free plan on signup"
```

---

### Task 2: `@evo/limits` package (TDD)

**Files:** new `packages/limits/`.

- [ ] **Step 1: package.json**

`packages/limits/package.json`:

```json
{
  "name": "@evo/limits",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@evo/db": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

`packages/limits/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: TDD test**

`packages/limits/src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniquePlan = vi.fn();
const countContacts = vi.fn();
const countInstances = vi.fn();
const countMessages = vi.fn();

vi.mock("@evo/db", () => ({
  prisma: {
    workspacePlan: {
      findUnique: vi.fn(async () => ({
        plan: { contactCap: 100, instanceCap: 2, monthlyMessageCap: 1000, featureFlags: {} },
      })),
    },
    contact: { count: countContacts },
    instance: { count: countInstances },
    message: { count: countMessages },
  },
}));

import { requireUnder, type LimitKind } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUnder", () => {
  it("returns { allowed: true } when under cap (contact)", async () => {
    countContacts.mockResolvedValue(50);
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(50);
    expect(result.cap).toBe(100);
  });

  it("returns { allowed: false } when at cap (contact)", async () => {
    countContacts.mockResolvedValue(100);
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(100);
    expect(result.cap).toBe(100);
  });

  it("returns { allowed: true } for instance under cap", async () => {
    countInstances.mockResolvedValue(1);
    const result = await requireUnder("ws-1", "instance");
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(2);
  });

  it("returns { allowed: false } when monthly messages exceeded", async () => {
    countMessages.mockResolvedValue(1000);
    const result = await requireUnder("ws-1", "messageMonthly");
    expect(result.allowed).toBe(false);
    expect(result.cap).toBe(1000);
  });

  it("returns { allowed: true, cap: Infinity } when PLAN_ENFORCE=false", async () => {
    process.env.PLAN_ENFORCE = "false";
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(Infinity);
    delete process.env.PLAN_ENFORCE;
  });
});
```

- [ ] **Step 3: Implement**

`packages/limits/src/index.ts`:

```typescript
import { prisma } from "@evo/db";

export type LimitKind = "contact" | "instance" | "messageMonthly";

export interface LimitResult {
  allowed: boolean;
  used: number;
  cap: number;
}

export async function requireUnder(workspaceId: string, kind: LimitKind): Promise<LimitResult> {
  if (process.env.PLAN_ENFORCE === "false") {
    return { allowed: true, used: 0, cap: Infinity };
  }

  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!wp) {
    // No plan attached — treat as no caps
    return { allowed: true, used: 0, cap: Infinity };
  }

  let cap = 0;
  let used = 0;
  if (kind === "contact") {
    cap = wp.plan.contactCap;
    used = await prisma.contact.count({ where: { workspaceId } });
  } else if (kind === "instance") {
    cap = wp.plan.instanceCap;
    used = await prisma.instance.count({ where: { workspaceId } });
  } else if (kind === "messageMonthly") {
    cap = wp.plan.monthlyMessageCap;
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    used = await prisma.message.count({
      where: { workspaceId, sentAt: { gte: start } },
    });
  }

  return { allowed: used < cap, used, cap };
}

export async function featureEnabled(workspaceId: string, flag: string): Promise<boolean> {
  if (process.env.PLAN_ENFORCE === "false") return true;
  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!wp) return false;
  const flags = wp.plan.featureFlags as Record<string, unknown>;
  return Boolean(flags?.[flag]);
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm install
pnpm --filter @evo/limits test
pnpm --filter @evo/limits typecheck
git add packages/limits pnpm-lock.yaml
git commit -m "feat(limits): @evo/limits requireUnder + featureEnabled helpers"
```

Expected: 5/5 passing.

---

### Task 3: Wire limit enforcement into contacts + instances + broadcasts

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[slug]/contacts/route.ts` (POST handler)
- Modify: `apps/web/src/app/api/workspaces/[slug]/instances/route.ts` (POST handler)
- Modify: `apps/web/src/app/api/workspaces/[slug]/broadcasts/[id]/start/route.ts` (POST handler)
- Modify: `apps/web/package.json` (add `@evo/limits` workspace dep)

- [ ] **Step 1: Add dep to apps/web/package.json**

In `dependencies`, add:

```json
    "@evo/limits": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 2: Contacts route** — read the existing POST handler. After `requireMember(slug, "Admin")` and before the `db.contact.create(...)` call, add:

```typescript
    const { requireUnder } = await import("@evo/limits");
    const limit = await requireUnder(workspace.id, "contact");
    if (!limit.allowed) {
      return NextResponse.json({ error: "PLAN_CAP_REACHED", limit }, { status: 402 });
    }
```

- [ ] **Step 3: Instances route** — same pattern, in the POST handler before `db.instance.create(...)`:

```typescript
    const { requireUnder } = await import("@evo/limits");
    const limit = await requireUnder(workspace.id, "instance");
    if (!limit.allowed) {
      return NextResponse.json({ error: "PLAN_CAP_REACHED", limit }, { status: 402 });
    }
```

- [ ] **Step 4: Broadcasts start route** — before transitioning to running, check message cap:

```typescript
    const { requireUnder } = await import("@evo/limits");
    const limit = await requireUnder(workspace.id, "messageMonthly");
    if (!limit.allowed) {
      return NextResponse.json({ error: "PLAN_CAP_REACHED", limit }, { status: 402 });
    }
```

Insert this after `requireMember(...)` and before `db.warmerRun.findUnique(...)` (or wherever the existing broadcast lookup is).

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
pnpm --filter @evo/web test
git add "apps/web/src/app/api/workspaces/[slug]/contacts/route.ts" "apps/web/src/app/api/workspaces/[slug]/instances/route.ts" "apps/web/src/app/api/workspaces/[slug]/broadcasts/[id]/start/route.ts" apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): enforce plan caps on contacts, instances, broadcast start"
```

Expected: typecheck PASS, tests still 17 passing.

---

### Task 4: Workspace plan API + settings page

**Files:**
- New: `apps/web/src/app/api/workspaces/[slug]/plan/route.ts`
- New: `apps/web/src/app/[workspaceSlug]/settings/plan/page.tsx`
- Modify: `apps/web/messages/en-GB.json` (add `plan.*`)

- [ ] **Step 1: `plan/route.ts`** (GET — returns the plan + current usage)

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { requireUnder } from "@evo/limits";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const wp = await prisma.workspacePlan.findUnique({
      where: { workspaceId: workspace.id },
      include: { plan: true },
    });
    const [contact, instance, messageMonthly] = await Promise.all([
      requireUnder(workspace.id, "contact"),
      requireUnder(workspace.id, "instance"),
      requireUnder(workspace.id, "messageMonthly"),
    ]);
    return NextResponse.json({
      plan: wp?.plan ?? null,
      since: wp?.since ?? null,
      usage: { contact, instance, messageMonthly },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: i18n**

Add to `en-GB.json`:

```json
  "plan": {
    "title": "Plan & usage",
    "currentPlan": "Current plan",
    "noPlan": "No plan assigned",
    "since": "Active since",
    "usage": "Usage this month",
    "contacts": "Contacts",
    "instances": "WhatsApp instances",
    "messagesMonthly": "Messages this month",
    "capReached": "Cap reached — upgrade to send more"
  },
```

- [ ] **Step 3: Settings page**

`apps/web/src/app/[workspaceSlug]/settings/plan/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { requireUnder } from "@evo/limits";

function Row({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap === Infinity ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-gray-500">{used} / {cap === Infinity ? "∞" : cap}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-black" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId: workspace.id },
    include: { plan: true },
  });
  const [contact, instance, messageMonthly] = await Promise.all([
    requireUnder(workspace.id, "contact"),
    requireUnder(workspace.id, "instance"),
    requireUnder(workspace.id, "messageMonthly"),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("plan.title")}</h1>
      <section className="border rounded p-4 space-y-2">
        <h2 className="text-sm text-gray-500">{t("plan.currentPlan")}</h2>
        {wp?.plan ? (
          <>
            <p className="text-lg font-semibold">{wp.plan.name}</p>
            <p className="text-sm text-gray-600">{wp.plan.description}</p>
            <p className="text-xs text-gray-500">{t("plan.since")}: {wp.since.toLocaleDateString("en-GB")}</p>
          </>
        ) : (
          <p className="text-gray-500">{t("plan.noPlan")}</p>
        )}
      </section>
      <section className="border rounded p-4 space-y-3">
        <h2 className="text-sm text-gray-500">{t("plan.usage")}</h2>
        <Row label={t("plan.contacts")} used={contact.used} cap={contact.cap} />
        <Row label={t("plan.instances")} used={instance.used} cap={instance.cap} />
        <Row label={t("plan.messagesMonthly")} used={messageMonthly.used} cap={messageMonthly.cap} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/plan" "apps/web/src/app/[workspaceSlug]/settings/plan" apps/web/messages/en-GB.json
git commit -m "feat(web): workspace plan settings page with usage meters"
```

---

### Task 5: Super-admin guard + admin API

**Files:**
- New: `apps/web/src/lib/super-admin.ts`
- New: `apps/web/src/app/api/admin/workspaces/route.ts`
- New: `apps/web/src/app/api/admin/users/route.ts`
- New: `apps/web/src/app/api/admin/plans/route.ts`
- New: `apps/web/src/app/api/admin/health/route.ts`

- [ ] **Step 1: `super-admin.ts`**

```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { ForbiddenError } from "@evo/shared";

export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new ForbiddenError("Not signed in");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, isSuperAdmin: true } });
  if (!user || !user.isSuperAdmin) throw new ForbiddenError("Not a super-admin");
  return { userId: user.id };
}
```

- [ ] **Step 2: admin/workspaces**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const workspaces = await prisma.workspace.findMany({
      include: {
        _count: { select: { members: true, instances: true, contacts: true } },
        plan: { include: { plan: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ workspaces });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: admin/users**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const users = await prisma.user.findMany({
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ users });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 4: admin/plans**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

const schema = z.object({
  id: z.string().optional(),
  kind: z.enum(["free", "pro", "enterprise", "custom"]),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  contactCap: z.number().int().min(0),
  instanceCap: z.number().int().min(0),
  monthlyMessageCap: z.number().int().min(0),
  featureFlags: z.record(z.any()),
});

export async function GET() {
  try {
    await requireSuperAdmin();
    const plans = await prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
    return NextResponse.json({ plans });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const plan = await prisma.plan.upsert({
      where: { kind: parsed.data.kind },
      create: parsed.data as any,
      update: { ...parsed.data, featureFlags: parsed.data.featureFlags as any },
    });
    return NextResponse.json({ plan });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 5: admin/health**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { AppError } from "@evo/shared";

export async function GET() {
  try {
    await requireSuperAdmin();
    const [workspaceCount, userCount, instanceCount, recentMessages, runningWarmers, runningBroadcasts] = await Promise.all([
      prisma.workspace.count(),
      prisma.user.count(),
      prisma.instance.count(),
      prisma.message.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
      prisma.warmerRun.count({ where: { status: "running" } }),
      prisma.broadcast.count({ where: { status: "running" } }),
    ]);
    return NextResponse.json({
      workspaceCount, userCount, instanceCount, recentMessages,
      runningWarmers, runningBroadcasts,
      now: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 6: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add apps/web/src/lib/super-admin.ts "apps/web/src/app/api/admin"
git commit -m "feat(web): super-admin guard + admin API (workspaces, users, plans, health)"
```

---

### Task 6: Super-admin pages

**Files:**
- New: `apps/web/src/app/admin/layout.tsx`
- New: `apps/web/src/app/admin/page.tsx`
- New: `apps/web/src/app/admin/workspaces/page.tsx`
- New: `apps/web/src/app/admin/users/page.tsx`
- New: `apps/web/src/app/admin/plans/page.tsx`
- New: `apps/web/src/app/admin/plans/plans-editor.tsx`
- New: `apps/web/src/app/admin/health/page.tsx`
- Modify: `apps/web/messages/en-GB.json` (admin.*)
- Modify: `apps/web/src/middleware.ts` — allow `/admin/*` (already protected by auth) — should already work, just verify

- [ ] **Step 1: i18n**

Append to `en-GB.json`:

```json
  "admin": {
    "title": "Super admin",
    "workspaces": "Workspaces",
    "users": "Users",
    "plans": "Plans",
    "health": "Health"
  },
```

- [ ] **Step 2: Admin layout**

```tsx
// apps/web/src/app/admin/layout.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/super-admin";
import { ForbiddenError } from "@evo/shared";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/sign-in");
    throw e;
  }
  const t = await getTranslations();
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-100 p-4 space-y-2">
        <h2 className="font-semibold">{t("admin.title")}</h2>
        <Link href="/admin/workspaces" className="block">{t("admin.workspaces")}</Link>
        <Link href="/admin/users" className="block">{t("admin.users")}</Link>
        <Link href="/admin/plans" className="block">{t("admin.plans")}</Link>
        <Link href="/admin/health" className="block">{t("admin.health")}</Link>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: `app/admin/page.tsx`** (redirects to workspaces)

```tsx
import { redirect } from "next/navigation";

export default function AdminRoot() {
  redirect("/admin/workspaces");
}
```

- [ ] **Step 4: Workspaces page**

```tsx
// apps/web/src/app/admin/workspaces/page.tsx
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";

export default async function AdminWorkspacesPage() {
  await requireSuperAdmin();
  const workspaces = await prisma.workspace.findMany({
    include: {
      _count: { select: { members: true, instances: true, contacts: true } },
      plan: { include: { plan: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-3 max-w-4xl">
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      <table className="w-full text-sm border rounded">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">Name</th><th className="p-2">Plan</th><th className="p-2">Members</th><th className="p-2">Instances</th><th className="p-2">Contacts</th><th className="p-2">Created</th></tr>
        </thead>
        <tbody className="divide-y">
          {workspaces.map((w) => (
            <tr key={w.id}>
              <td className="p-2">{w.name}</td>
              <td className="p-2 text-center">{w.plan?.plan?.name ?? "—"}</td>
              <td className="p-2 text-center">{w._count.members}</td>
              <td className="p-2 text-center">{w._count.instances}</td>
              <td className="p-2 text-center">{w._count.contacts}</td>
              <td className="p-2 text-center text-xs">{w.createdAt.toLocaleDateString("en-GB")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Users page**

```tsx
// apps/web/src/app/admin/users/page.tsx
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";

export default async function AdminUsersPage() {
  await requireSuperAdmin();
  const users = await prisma.user.findMany({
    include: { _count: { select: { memberships: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return (
    <div className="space-y-3 max-w-3xl">
      <h1 className="text-2xl font-semibold">Users</h1>
      <table className="w-full text-sm border rounded">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">Email</th><th className="p-2">Name</th><th className="p-2">Workspaces</th><th className="p-2">Admin</th><th className="p-2">Joined</th></tr>
        </thead>
        <tbody className="divide-y">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="p-2">{u.email}</td>
              <td className="p-2">{u.name}</td>
              <td className="p-2 text-center">{u._count.memberships}</td>
              <td className="p-2 text-center">{u.isSuperAdmin ? "★" : ""}</td>
              <td className="p-2 text-center text-xs">{u.createdAt.toLocaleDateString("en-GB")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Plans page + editor**

`apps/web/src/app/admin/plans/page.tsx`:

```tsx
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import PlansEditor from "./plans-editor";

export default async function AdminPlansPage() {
  await requireSuperAdmin();
  const plans = await prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Plans</h1>
      <PlansEditor
        initial={plans.map((p) => ({
          id: p.id, kind: p.kind, name: p.name, description: p.description,
          contactCap: p.contactCap, instanceCap: p.instanceCap, monthlyMessageCap: p.monthlyMessageCap,
          featureFlags: p.featureFlags,
        }))}
      />
    </div>
  );
}
```

`apps/web/src/app/admin/plans/plans-editor.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Plan = { id: string; kind: string; name: string; description: string; contactCap: number; instanceCap: number; monthlyMessageCap: number; featureFlags: any };

export default function PlansEditor({ initial }: { initial: Plan[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(plan: Plan) {
    setBusy(true);
    await fetch("/api/admin/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: plan.kind, name: plan.name, description: plan.description,
        contactCap: plan.contactCap, instanceCap: plan.instanceCap, monthlyMessageCap: plan.monthlyMessageCap,
        featureFlags: typeof plan.featureFlags === "string" ? JSON.parse(plan.featureFlags) : plan.featureFlags,
      }),
    });
    setBusy(false);
    router.refresh();
  }

  function patch(id: string, field: keyof Plan, value: any) {
    setItems((arr) => arr.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  return (
    <div className="space-y-4">
      {items.map((p) => (
        <div key={p.id} className="border rounded p-4 space-y-2">
          <div className="flex justify-between items-center">
            <div className="flex gap-2 items-center">
              <span className="text-xs uppercase bg-gray-100 px-2 py-0.5 rounded">{p.kind}</span>
              <input className="border rounded p-1 text-sm" value={p.name} onChange={(e) => patch(p.id, "name", e.target.value)} />
            </div>
            <button disabled={busy} onClick={() => save(p)} className="bg-black text-white rounded p-1 px-3 text-sm">Save</button>
          </div>
          <textarea className="w-full border rounded p-2 text-xs" rows={2} value={p.description} onChange={(e) => patch(p.id, "description", e.target.value)} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <label className="space-y-1"><span>Contact cap</span><input type="number" className="w-full border rounded p-1" value={p.contactCap} onChange={(e) => patch(p.id, "contactCap", Number(e.target.value))} /></label>
            <label className="space-y-1"><span>Instance cap</span><input type="number" className="w-full border rounded p-1" value={p.instanceCap} onChange={(e) => patch(p.id, "instanceCap", Number(e.target.value))} /></label>
            <label className="space-y-1"><span>Msg/mo cap</span><input type="number" className="w-full border rounded p-1" value={p.monthlyMessageCap} onChange={(e) => patch(p.id, "monthlyMessageCap", Number(e.target.value))} /></label>
          </div>
          <label className="space-y-1 block text-xs">
            <span>Feature flags JSON</span>
            <textarea className="w-full border rounded p-1 font-mono" rows={2} value={JSON.stringify(p.featureFlags)} onChange={(e) => patch(p.id, "featureFlags", e.target.value)} />
          </label>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Health page**

```tsx
// apps/web/src/app/admin/health/page.tsx
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";

export default async function AdminHealthPage() {
  await requireSuperAdmin();
  const [workspaceCount, userCount, instanceCount, recentMessages, runningWarmers, runningBroadcasts] = await Promise.all([
    prisma.workspace.count(),
    prisma.user.count(),
    prisma.instance.count(),
    prisma.message.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.warmerRun.count({ where: { status: "running" } }),
    prisma.broadcast.count({ where: { status: "running" } }),
  ]);
  const tiles = [
    { label: "Workspaces", value: workspaceCount },
    { label: "Users", value: userCount },
    { label: "Instances", value: instanceCount },
    { label: "Messages last 24h", value: recentMessages },
    { label: "Running warmers", value: runningWarmers },
    { label: "Running broadcasts", value: runningBroadcasts },
  ];
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-2xl font-semibold">Health</h1>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="border rounded p-3 text-center">
            <div className="text-xs text-gray-500">{t.label}</div>
            <div className="text-2xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add apps/web/src/app/admin apps/web/messages/en-GB.json
git commit -m "feat(web): super-admin pages (workspaces, users, plans editor, health)"
```

---

### Task 7: Workspace analytics (messages / broadcasts / warmer)

**Files:**
- New: `apps/web/src/app/[workspaceSlug]/analytics/page.tsx` (redirect)
- New: `apps/web/src/app/[workspaceSlug]/analytics/messages/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/analytics/messages/messages-chart.tsx`
- New: `apps/web/src/app/[workspaceSlug]/analytics/broadcasts/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/analytics/broadcasts/broadcasts-chart.tsx`
- New: `apps/web/src/app/[workspaceSlug]/analytics/warmer/page.tsx`
- New: `apps/web/src/app/[workspaceSlug]/analytics/warmer/warmer-chart.tsx`
- Modify: `apps/web/messages/en-GB.json` (analytics.* + nav.analytics)
- Modify: `apps/web/src/app/[workspaceSlug]/layout.tsx` (nav link)
- Modify: `apps/web/package.json` (recharts dep)

- [ ] **Step 1: Add recharts**

In `apps/web/package.json` dependencies:

```json
    "recharts": "^2.13.3",
```

Run `pnpm install`.

- [ ] **Step 2: i18n + nav**

Add `"analytics": "Analytics"` to the `nav` namespace. Add a new `analytics` namespace:

```json
  "analytics": {
    "title": "Analytics",
    "messages": "Messages",
    "broadcasts": "Broadcasts",
    "warmer": "Warmer",
    "noData": "No data yet"
  },
```

In `apps/web/src/app/[workspaceSlug]/layout.tsx`, add the link after Warmer:

```tsx
        <Link href={`/${workspaceSlug}/analytics`} className="block">{t("nav.analytics")}</Link>
```

- [ ] **Step 3: `analytics/page.tsx`** (redirect to /messages)

```tsx
import { redirect } from "next/navigation";

export default async function AnalyticsRoot({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/analytics/messages`);
}
```

- [ ] **Step 4: Messages chart (server + client)**

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/messages/page.tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import MessagesChart from "./messages-chart";

export default async function MessagesAnalyticsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const messages = await db.message.findMany({
    where: { sentAt: { gte: since } },
    select: { sentAt: true, direction: true },
    take: 100000,
  });
  // Aggregate by day + direction
  const buckets = new Map<string, { date: string; inbound: number; outbound: number }>();
  for (const m of messages) {
    const day = m.sentAt.toISOString().slice(0, 10);
    const b = buckets.get(day) ?? { date: day, inbound: 0, outbound: 0 };
    if (m.direction === "inbound") b.inbound++; else b.outbound++;
    buckets.set(day, b);
  }
  const data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  return <MessagesChart data={data} />;
}
```

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/messages/messages-chart.tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";

export default function MessagesChart({ data }: { data: { date: string; inbound: number; outbound: number }[] }) {
  if (data.length === 0) return <p className="text-gray-500 text-sm">No data yet</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Messages — last 30 days</h1>
      <div className="border rounded p-3 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey="inbound" stroke="#3b82f6" />
            <Line dataKey="outbound" stroke="#000" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Broadcasts chart**

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/broadcasts/page.tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import BroadcastsChart from "./broadcasts-chart";

export default async function BroadcastsAnalyticsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const counts = await db.broadcastTarget.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const data = ["queued", "sending", "sent", "delivered", "read", "failed"].map((status) => ({
    status,
    count: counts.find((c) => c.status === status)?._count._all ?? 0,
  }));
  return <BroadcastsChart data={data} />;
}
```

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/broadcasts/broadcasts-chart.tsx
"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

export default function BroadcastsChart({ data }: { data: { status: string; count: number }[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Broadcast funnel</h1>
      <div className="border rounded p-3 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="status" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#000" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Warmer chart**

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/warmer/page.tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import WarmerChart from "./warmer-chart";

export default async function WarmerAnalyticsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const events = await db.warmerEvent.findMany({
    where: { createdAt: { gte: since }, kind: "send" },
    select: { createdAt: true },
    take: 100000,
  });
  const buckets = new Map<string, { date: string; sends: number }>();
  for (const e of events) {
    const day = e.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(day) ?? { date: day, sends: 0 };
    b.sends++;
    buckets.set(day, b);
  }
  const data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  return <WarmerChart data={data} />;
}
```

```tsx
// apps/web/src/app/[workspaceSlug]/analytics/warmer/warmer-chart.tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

export default function WarmerChart({ data }: { data: { date: string; sends: number }[] }) {
  if (data.length === 0) return <div className="space-y-4"><h1 className="text-2xl font-semibold">Warmer activity</h1><p className="text-gray-500 text-sm">No data yet</p></div>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Warmer activity — last 14 days</h1>
      <div className="border rounded p-3 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line dataKey="sends" stroke="#000" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/analytics" "apps/web/src/app/[workspaceSlug]/layout.tsx" apps/web/messages/en-GB.json apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): analytics screens (messages, broadcasts, warmer) with recharts"
```

---

### Task 8: Plan 6 final review

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm -r test
```

Expected:
- All packages typecheck PASS
- `@evo/limits` 5 tests
- web tests still 17
- 6 e2e specs all still pass

- [ ] **Step 2: Plan 6 done.**

---

## Plan 6 verification checklist

- [ ] Migration `<14-digit>_plans/` exists with Plan + WorkspacePlan + isSuperAdmin column.
- [ ] 3 plans seeded (free / pro / enterprise).
- [ ] Workspace POST auto-assigns the free plan on signup.
- [ ] `@evo/limits.requireUnder` tests pass.
- [ ] Contacts/instances POST + broadcasts start route return 402 PLAN_CAP_REACHED at the cap.
- [ ] `/settings/plan` shows usage bars per category.
- [ ] `/admin/*` routes are gated by `requireSuperAdmin` and return 403 to non-super-admins.
- [ ] Plans editor saves updates via POST `/api/admin/plans`.
- [ ] `/analytics/messages|broadcasts|warmer` render charts (recharts).

When all checked: Plan 6 done.

**Deferred to a future Plan 6.5+ (explicitly):**
- Groups UI (Evolution-client group endpoints + group screens)
- Pass-through integration configurators (Chatwoot, Typebot, RabbitMQ, SQS, Kafka, Pusher) — forms that POST to Evolution's `/<integration>/set/<name>`
- Audit log viewer (`/settings/audit`)
- Webhook subscription manager (`/settings/webhooks`)
- Developer API keys CRUD (`/settings/api-keys`)
- Per-workspace AI provider keys
- Real billing integration (Stripe, etc.) — caps are enforced but upgrades are a manual admin action for v1.

Plus the still-deferred items from earlier plans:
- Drag-drop visual flow builder (Plan 4 deferral)
- Warmer polish: structured config editor, internal-chat enforcement, ramp curve, turn tracking (Plan 5 deferral)
