# Plan 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, manager database, auth, multi-tenant workspaces, and skeleton `web` / `worker` / `ingest` processes — so the next plans can build features on top.

**Architecture:** pnpm monorepo. Next.js 15 (App Router) for `web`, plain Node for `worker` and `ingest`. Prisma + Postgres (separate database from Evolution). Auth.js v5 with argon2id passwords. Multi-tenant via a `requireMember(workspaceId, role)` guard and a tenant-scoped Prisma client wrapper that injects `workspaceId` into every query. `next-intl` with `en-GB` as the only locale. docker-compose ties everything together; Caddy fronts it with auto-TLS.

**Tech Stack:** Next.js 15, TypeScript 5.7, pnpm 9, Prisma 6, Postgres 16, Redis 7, Auth.js v5 (`@auth/core` + `@auth/prisma-adapter`), argon2, next-intl, shadcn/ui + Tailwind, Vitest, Playwright, Caddy 2, Docker.

**Definition of done:** A new user can sign up, create a workspace, see the workspace dashboard placeholder, invite a teammate by email, the teammate can accept the invite link and join the workspace as an Agent. All exercised by Playwright.

**Spec reference:** `docs/superpowers/specs/2026-06-17-nextjs-manager-design.md` — Sections 1 (data model: Identity + tenancy), 6 (deployment baseline).

---

## File structure produced by this plan

```
/
├─ package.json                                  # workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .gitignore
├─ .env.example
├─ docker-compose.yml
├─ Caddyfile
├─ packages/
│  ├─ db/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ prisma/schema.prisma
│  │  └─ src/
│  │     ├─ index.ts                             # prisma singleton
│  │     ├─ tenant.ts                            # tenancy-guarded client
│  │     └─ tenant.test.ts
│  └─ shared/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts
│        ├─ errors.ts
│        ├─ errors.test.ts
│        └─ slug.ts
├─ apps/
│  ├─ web/
│  │  ├─ package.json
│  │  ├─ next.config.ts
│  │  ├─ tsconfig.json
│  │  ├─ tailwind.config.ts
│  │  ├─ postcss.config.mjs
│  │  ├─ vitest.config.ts
│  │  ├─ playwright.config.ts
│  │  ├─ Dockerfile
│  │  ├─ messages/en-GB.json
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ layout.tsx
│  │     │  ├─ globals.css
│  │     │  ├─ page.tsx                          # redirects to /sign-in or /onboarding
│  │     │  ├─ (auth)/
│  │     │  │  ├─ layout.tsx
│  │     │  │  ├─ sign-in/page.tsx
│  │     │  │  ├─ sign-up/page.tsx
│  │     │  │  └─ accept-invite/[token]/page.tsx
│  │     │  ├─ onboarding/page.tsx
│  │     │  ├─ [workspaceSlug]/
│  │     │  │  ├─ layout.tsx
│  │     │  │  ├─ dashboard/page.tsx
│  │     │  │  └─ settings/
│  │     │  │     ├─ layout.tsx
│  │     │  │     └─ members/page.tsx
│  │     │  └─ api/
│  │     │     ├─ auth/[...nextauth]/route.ts
│  │     │     ├─ sign-up/route.ts
│  │     │     ├─ workspaces/route.ts
│  │     │     └─ workspaces/[slug]/
│  │     │        ├─ invitations/route.ts
│  │     │        └─ members/[memberId]/route.ts
│  │     ├─ lib/
│  │     │  ├─ auth.ts                           # Auth.js config
│  │     │  ├─ auth.test.ts
│  │     │  ├─ password.ts
│  │     │  ├─ password.test.ts
│  │     │  ├─ tenancy.ts                        # requireMember
│  │     │  └─ tenancy.test.ts
│  │     ├─ i18n.ts
│  │     ├─ middleware.ts
│  │     └─ components/
│  │        └─ ui/                               # shadcn-installed components
│  └─ worker/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ Dockerfile
│     └─ src/index.ts                            # /healthz + heartbeat log
│  └─ ingest/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ Dockerfile
│     └─ src/index.ts                            # /healthz + stub webhook route
└─ tests/e2e/
   ├─ auth-and-workspace.spec.ts
   └─ playwright.helpers.ts
```

Tasks below build this in order.

---

### Task 1: Monorepo skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Initialise pnpm workspace**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create root `package.json`:

```json
{
  "name": "evolution-manager",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm -r --parallel --filter=./apps/* dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "db:generate": "pnpm --filter @evo/db generate",
    "db:migrate": "pnpm --filter @evo/db migrate",
    "seed": "pnpm --filter @evo/db seed"
  },
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Add root tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Add .gitignore**

```gitignore
node_modules
.next
dist
.turbo
*.log
.env
.env.*.local
.DS_Store
coverage
playwright-report
test-results
prisma/migrations/.tmp
```

- [ ] **Step 4: Add .env.example**

```bash
# Manager DB
DATABASE_URL="postgresql://manager:manager@localhost:5432/evolution_manager?schema=public"

# Manager Redis
REDIS_URL="redis://localhost:6379/0"

# Evolution upstream
EVOLUTION_BASE_URL="http://localhost:8080"
EVOLUTION_GLOBAL_API_KEY="change-me"
WEBHOOK_PUBLIC_BASE_URL="http://localhost:4000"

# Auth.js
AUTH_SECRET="change-me-with-openssl-rand-hex-32"
AUTH_URL="http://localhost:3000"

# Locale
DEFAULT_LOCALE="en-GB"
DEFAULT_TIMEZONE="Asia/Kuala_Lumpur"

# Plan enforcement (off in dev)
PLAN_ENFORCE="false"

# Logging
LOG_LEVEL="info"
```

- [ ] **Step 5: Install root deps and commit**

```bash
pnpm install
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore .env.example
git commit -m "chore: scaffold pnpm monorepo"
```

Expected: `pnpm install` succeeds, creates `pnpm-lock.yaml`.

---

### Task 2: `@evo/db` package — Prisma schema for identity

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@evo/db",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate deploy",
    "migrate:dev": "prisma migrate dev",
    "studio": "prisma studio",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0"
  },
  "devDependencies": {
    "prisma": "^6.1.0",
    "vitest": "^2.1.0",
    "typescript": "5.7.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create prisma/schema.prisma (identity tables only — Plan 0 scope)**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum WorkspaceRole {
  Owner
  Admin
  Agent
  Viewer
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  locale       String   @default("en-GB")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships WorkspaceMember[]
  sessions    Session[]
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  sessionToken String   @unique
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Workspace {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  timezone        String   @default("Asia/Kuala_Lumpur")
  defaultLocale   String   @default("en-GB")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  members     WorkspaceMember[]
  invitations Invitation[]
}

model WorkspaceMember {
  id          String        @id @default(cuid())
  workspaceId String
  userId      String
  role        WorkspaceRole @default(Agent)
  createdAt   DateTime      @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model Invitation {
  id          String        @id @default(cuid())
  workspaceId String
  email       String
  role        WorkspaceRole
  token       String        @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime      @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([email])
}
```

- [ ] **Step 4: Create src/index.ts (Prisma singleton)**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.LOG_LEVEL === "debug" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "@prisma/client";
```

- [ ] **Step 5: Install and generate**

Run:

```bash
pnpm install
pnpm --filter @evo/db generate
```

Expected: `@prisma/client` types generated under `node_modules/.prisma/client`.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): add identity schema (User, Session, Workspace, Member, Invitation)"
```

---

### Task 3: docker-compose with Postgres + Redis (manager DB only — Evolution comes later)

**Files:**
- Create: `docker-compose.yml`
- Create: `Caddyfile`

- [ ] **Step 1: docker-compose.yml**

```yaml
name: evolution-manager
services:
  postgres-manager:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: manager
      POSTGRES_PASSWORD: manager
      POSTGRES_DB: evolution_manager
    ports:
      - "5432:5432"
    volumes:
      - postgres-manager-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U manager"]
      interval: 5s
      retries: 10

  redis-manager:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-manager-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

volumes:
  postgres-manager-data:
  redis-manager-data:
```

- [ ] **Step 2: Caddyfile placeholder (used in later tasks)**

```Caddyfile
{
  email admin@localhost
  auto_https off
}

:80 {
  handle /api/whatsapp/webhook/* {
    reverse_proxy ingest:4000
  }
  handle {
    reverse_proxy web:3000
  }
}
```

- [ ] **Step 3: Bring up DB and verify**

Run:

```bash
docker compose up -d postgres-manager redis-manager
docker compose ps
```

Expected: both containers report `healthy`.

- [ ] **Step 4: Apply first migration**

Copy `.env.example` to `.env` and edit `DATABASE_URL` to match. Run:

```bash
cp .env.example .env
pnpm --filter @evo/db exec prisma migrate dev --name init
```

Expected: migration file created under `packages/db/prisma/migrations/`. Prisma reports "Already in sync, no schema change."

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml Caddyfile packages/db/prisma/migrations
git commit -m "feat(infra): docker-compose postgres + redis, initial migration"
```

---

### Task 4: `@evo/shared` package — errors and slug helper (TDD)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/errors.ts`
- Test: `packages/shared/src/errors.test.ts`
- Create: `packages/shared/src/slug.ts`
- Test: `packages/shared/src/slug.test.ts`

- [ ] **Step 1: package.json + tsconfig**

`packages/shared/package.json`:

```json
{
  "name": "@evo/shared",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "5.7.2"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write failing test for errors**

`packages/shared/src/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

describe("AppError", () => {
  it("carries a code and an http status", () => {
    const e = new AppError("oops", { code: "OOPS", status: 418 });
    expect(e.code).toBe("OOPS");
    expect(e.status).toBe(418);
    expect(e.message).toBe("oops");
  });

  it("ForbiddenError defaults to 403", () => {
    expect(new ForbiddenError("nope").status).toBe(403);
  });

  it("NotFoundError defaults to 404", () => {
    expect(new NotFoundError("gone").status).toBe(404);
  });

  it("ValidationError defaults to 400 and carries field issues", () => {
    const e = new ValidationError("bad", { issues: [{ field: "email", message: "required" }] });
    expect(e.status).toBe(400);
    expect(e.issues).toEqual([{ field: "email", message: "required" }]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @evo/shared test
```

Expected: FAIL — module './errors' not found.

- [ ] **Step 4: Implement errors.ts**

`packages/shared/src/errors.ts`:

```typescript
export interface ValidationIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, opts: { code: string; status: number }) {
    super(message);
    this.code = opts.code;
    this.status = opts.status;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { code: "FORBIDDEN", status: 403 });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, { code: "NOT_FOUND", status: 404 });
  }
}

export class ValidationError extends AppError {
  readonly issues: ValidationIssue[];
  constructor(message: string, opts: { issues: ValidationIssue[] }) {
    super(message, { code: "VALIDATION", status: 400 });
    this.issues = opts.issues;
  }
}
```

- [ ] **Step 5: Re-run test**

```bash
pnpm --filter @evo/shared test
```

Expected: PASS.

- [ ] **Step 6: Write failing slug test**

`packages/shared/src/slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toSlug } from "./slug";

describe("toSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(toSlug("St John's Clinic")).toBe("st-johns-clinic");
  });

  it("collapses repeated hyphens", () => {
    expect(toSlug("a  b---c")).toBe("a-b-c");
  });

  it("strips diacritics", () => {
    expect(toSlug("café")).toBe("cafe");
  });

  it("rejects empty result", () => {
    expect(() => toSlug("!!!")).toThrow(/invalid slug/i);
  });
});
```

- [ ] **Step 7: Run to verify fail, then implement**

```bash
pnpm --filter @evo/shared test
```

Expected: FAIL — module './slug' not found.

`packages/shared/src/slug.ts`:

```typescript
export function toSlug(input: string): string {
  const stripped = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stripped) throw new Error("invalid slug");
  return stripped;
}
```

- [ ] **Step 8: src/index.ts re-export**

`packages/shared/src/index.ts`:

```typescript
export * from "./errors";
export * from "./slug";
```

- [ ] **Step 9: Run tests, commit**

```bash
pnpm --filter @evo/shared test
git add packages/shared
git commit -m "feat(shared): error classes and slug helper with tests"
```

Expected: tests PASS.

---

### Task 5: Tenancy-guarded Prisma wrapper (TDD)

**Files:**
- Create: `packages/db/src/tenant.ts`
- Test: `packages/db/src/tenant.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Install vitest dev deps and add docker-compose test database**

The test uses a real Postgres (separate DB) to verify Prisma behaviour, not mocks.

`packages/db/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
  },
});
```

`packages/db/src/test-setup.ts`:

```typescript
import { execSync } from "node:child_process";
import { beforeAll } from "vitest";

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://manager:manager@localhost:5432/evolution_manager_test?schema=public";
  }
  execSync(`pnpm exec prisma migrate deploy`, {
    cwd: __dirname + "/..",
    env: { ...process.env },
    stdio: "inherit",
  });
});
```

Create the test database manually once:

```bash
docker compose exec postgres-manager psql -U manager -c "CREATE DATABASE evolution_manager_test;"
```

- [ ] **Step 2: Write failing test**

`packages/db/src/tenant.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index";
import { tenantClient } from "./tenant";

describe("tenantClient", () => {
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    await prisma.workspaceMember.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.workspace.deleteMany();
    const a = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
    const b = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });
    workspaceA = a.id;
    workspaceB = b.id;
    await prisma.invitation.create({
      data: { workspaceId: workspaceA, email: "x@a.com", role: "Agent", token: "ta" + Date.now(), expiresAt: new Date(Date.now() + 86400000) },
    });
    await prisma.invitation.create({
      data: { workspaceId: workspaceB, email: "y@b.com", role: "Agent", token: "tb" + Date.now(), expiresAt: new Date(Date.now() + 86400000) },
    });
  });

  it("findMany on Invitation only returns rows for the bound workspace", async () => {
    const db = tenantClient(workspaceA);
    const found = await db.invitation.findMany();
    expect(found).toHaveLength(1);
    expect(found[0]?.workspaceId).toBe(workspaceA);
  });

  it("create() forces workspaceId even when caller passes a different one", async () => {
    const db = tenantClient(workspaceA);
    const created = await db.invitation.create({
      data: {
        workspaceId: workspaceB, // attempt to sneak across
        email: "z@a.com",
        role: "Agent",
        token: "tz" + Date.now(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    expect(created.workspaceId).toBe(workspaceA);
  });

  it("does not affect untenanted models like User", async () => {
    const db = tenantClient(workspaceA);
    await prisma.user.create({ data: { email: "u@e.com", passwordHash: "x", name: "U" } });
    const users = await db.user.findMany();
    expect(users.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run test to verify fail**

```bash
pnpm --filter @evo/db test
```

Expected: FAIL — module './tenant' not found.

- [ ] **Step 4: Implement tenantClient**

`packages/db/src/tenant.ts`:

```typescript
import { Prisma } from "@prisma/client";
import { prisma } from "./index";

const TENANTED_MODELS = new Set<string>([
  "Workspace",
  "WorkspaceMember",
  "Invitation",
]);

export function tenantClient(workspaceId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANTED_MODELS.has(model)) return query(args);

          const tenantedWrite = ["create", "createMany", "upsert"];
          const tenantedRead = ["findFirst", "findMany", "findUnique", "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany"];

          if (tenantedWrite.includes(operation)) {
            // for Workspace itself, the id IS the workspaceId — leave alone
            if (model === "Workspace") return query(args);
            const a = args as any;
            if (operation === "createMany" && Array.isArray(a.data)) {
              a.data = a.data.map((row: any) => ({ ...row, workspaceId }));
            } else if (a.data) {
              a.data = { ...a.data, workspaceId };
            }
            return query(a);
          }

          if (tenantedRead.includes(operation)) {
            const a = args as any;
            if (model === "Workspace") {
              a.where = { ...(a.where ?? {}), id: workspaceId };
            } else {
              a.where = { ...(a.where ?? {}), workspaceId };
            }
            return query(a);
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof tenantClient>;
```

- [ ] **Step 5: Re-run tests until green**

```bash
pnpm --filter @evo/db test
```

Expected: PASS — all three tenancy tests pass.

- [ ] **Step 6: Export from index**

Append to `packages/db/src/index.ts`:

```typescript
export { tenantClient, type TenantClient } from "./tenant";
```

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): tenant-scoped Prisma client with passing tests"
```

---

### Task 6: Next.js `web` app skeleton with en-GB i18n

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/i18n.ts`
- Create: `apps/web/messages/en-GB.json`

- [ ] **Step 1: package.json**

```json
{
  "name": "@evo/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@auth/core": "^0.37.0",
    "@auth/prisma-adapter": "^2.7.0",
    "@evo/db": "workspace:*",
    "@evo/shared": "workspace:*",
    "argon2": "^0.41.0",
    "next": "15.0.3",
    "next-auth": "5.0.0-beta.25",
    "next-intl": "^3.23.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.0.0",
    "eslint-config-next": "15.0.3",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.14",
    "typescript": "5.7.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: next.config.ts with next-intl plugin**

```typescript
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const config: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default withNextIntl(config);
```

- [ ] **Step 4: Tailwind config**

`apps/web/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
```

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: i18n setup**

`apps/web/src/i18n.ts`:

```typescript
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  const locale = process.env.DEFAULT_LOCALE ?? "en-GB";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

`apps/web/messages/en-GB.json`:

```json
{
  "common": {
    "appName": "Evolution Manager",
    "signIn": "Sign in",
    "signUp": "Sign up",
    "signOut": "Sign out",
    "email": "Email",
    "password": "Password",
    "name": "Name",
    "cancel": "Cancel",
    "save": "Save",
    "delete": "Delete",
    "invite": "Invite",
    "submit": "Submit"
  },
  "auth": {
    "signInTitle": "Sign in to your workspace",
    "signUpTitle": "Create your account",
    "signUpCta": "Create account",
    "noAccount": "Don't have an account?",
    "hasAccount": "Already have an account?",
    "passwordsDoNotMatch": "Passwords do not match",
    "wrongCredentials": "Email or password is incorrect"
  },
  "onboarding": {
    "title": "Create your workspace",
    "workspaceName": "Workspace name",
    "create": "Create workspace"
  },
  "dashboard": {
    "title": "Dashboard",
    "welcome": "Welcome to {workspace}"
  },
  "members": {
    "title": "Team members",
    "inviteHeading": "Invite a teammate",
    "role": "Role",
    "roleOwner": "Owner",
    "roleAdmin": "Admin",
    "roleAgent": "Agent",
    "roleViewer": "Viewer",
    "pendingInvitations": "Pending invitations",
    "remove": "Remove",
    "you": "(you)"
  },
  "invite": {
    "acceptTitle": "You've been invited to {workspace}",
    "accept": "Accept invitation",
    "expired": "This invitation has expired or has already been used"
  }
}
```

- [ ] **Step 6: Root layout + globals**

`apps/web/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { height: 100%; }
body { font-family: ui-sans-serif, system-ui, sans-serif; }
```

`apps/web/src/app/layout.tsx`:

```tsx
import "./globals.css";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";

export const metadata = { title: "Evolution Manager" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Root page redirects to /sign-in**

`apps/web/src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/sign-in");
}
```

- [ ] **Step 8: Verify it boots**

```bash
pnpm install
pnpm --filter @evo/web dev
```

Open `http://localhost:3000`. Expected: 308 → `/sign-in`, which 404s for now (that's fine — Task 8 wires it).

Stop the dev server. Commit:

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Next.js 15 app with en-GB i18n"
```

---

### Task 7: Password hashing helper (TDD)

**Files:**
- Create: `apps/web/src/lib/password.ts`
- Test: `apps/web/src/lib/password.test.ts`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: vitest config**

`apps/web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] **Step 2: Write failing test**

`apps/web/src/lib/password.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("hashes and verifies round-trips", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(await verifyPassword(hash, "hunter2")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("produces different hashes for the same password", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run, verify fail, implement**

```bash
pnpm --filter @evo/web test
```

Expected: FAIL — module './password' not found.

`apps/web/src/lib/password.ts`:

```typescript
import argon2 from "argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Re-run, commit**

```bash
pnpm --filter @evo/web test
git add apps/web/src/lib/password.ts apps/web/src/lib/password.test.ts apps/web/vitest.config.ts
git commit -m "feat(web): argon2id password hashing helper"
```

Expected: PASS.

---

### Task 8: Auth.js configuration with credentials provider + Prisma adapter

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Auth.js config**

`apps/web/src/lib/auth.ts`:

```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@evo/db";
import { verifyPassword } from "./password";
import { z } from "zod";

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user) return null;
        const ok = await verifyPassword(user.passwordHash, parsed.data.password);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name?: string | null; image?: string | null };
  }
}
```

- [ ] **Step 2: Auth route handler**

`apps/web/src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 3: Middleware (protect everything except auth + onboarding)**

`apps/web/src/middleware.ts`:

```typescript
import { auth } from "@/lib/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/sign-up");
  if (isPublic) return;
  if (!req.auth) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("next", pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
```

- [ ] **Step 4: Verify build typechecks**

```bash
pnpm --filter @evo/web typecheck
```

Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/app/api/auth apps/web/src/middleware.ts
git commit -m "feat(web): Auth.js with credentials provider + JWT sessions"
```

---

### Task 9: Sign-up route + sign-up page

**Files:**
- Create: `apps/web/src/app/api/sign-up/route.ts`
- Create: `apps/web/src/app/(auth)/layout.tsx`
- Create: `apps/web/src/app/(auth)/sign-up/page.tsx`
- Create: `apps/web/src/app/(auth)/sign-in/page.tsx`

- [ ] **Step 1: Sign-up API route**

`apps/web/src/app/api/sign-up/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { hashPassword } from "@/lib/password";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
  }
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    },
    select: { id: true, email: true, name: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}
```

- [ ] **Step 2: Auth layout**

`apps/web/src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white shadow rounded">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Sign-up page (server component shell + client form)**

`apps/web/src/app/(auth)/sign-up/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";

export default function SignUpPage() {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Sign up failed");
      setBusy(false);
      return;
    }
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(t("auth.wrongCredentials"));
      setBusy(false);
      return;
    }
    router.push("/onboarding");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">{t("auth.signUpTitle")}</h1>
      <input className="w-full border rounded p-2" placeholder={t("common.name")} value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="w-full border rounded p-2" type="email" placeholder={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="w-full border rounded p-2" type="password" placeholder={t("common.password")} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={busy} className="w-full bg-black text-white rounded p-2">{t("auth.signUpCta")}</button>
      <p className="text-sm">
        {t("auth.hasAccount")} <a href="/sign-in" className="underline">{t("common.signIn")}</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 4: Sign-in page**

`apps/web/src/app/(auth)/sign-in/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/onboarding";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(t("auth.wrongCredentials"));
      setBusy(false);
      return;
    }
    router.push(next);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">{t("auth.signInTitle")}</h1>
      <input className="w-full border rounded p-2" type="email" placeholder={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="w-full border rounded p-2" type="password" placeholder={t("common.password")} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={busy} className="w-full bg-black text-white rounded p-2">{t("common.signIn")}</button>
      <p className="text-sm">
        {t("auth.noAccount")} <a href="/sign-up" className="underline">{t("common.signUp")}</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 5: Manual smoke test, then commit**

```bash
pnpm --filter @evo/web dev
```

Open `http://localhost:3000/sign-up`, fill form, expect to be redirected to `/onboarding` (which 404s — fixed next task).

```bash
git add apps/web/src/app/api/sign-up apps/web/src/app/'(auth)'
git commit -m "feat(web): sign-up / sign-in pages and sign-up API"
```

---

### Task 10: Onboarding — create first workspace

**Files:**
- Create: `apps/web/src/app/onboarding/page.tsx`
- Create: `apps/web/src/app/api/workspaces/route.ts`
- Create: `apps/web/src/lib/tenancy.ts`
- Test: `apps/web/src/lib/tenancy.test.ts`

- [ ] **Step 1: requireMember helper (TDD)**

Failing test first — `apps/web/src/lib/tenancy.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@evo/shared";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@evo/db", () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { requireMember } from "./tenancy";

const mockedAuth = vi.mocked(auth);
const mockedFindWorkspace = vi.mocked(prisma.workspace.findUnique);
const mockedFindMember = vi.mocked(prisma.workspaceMember.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireMember", () => {
  it("throws ForbiddenError when there is no session", async () => {
    mockedAuth.mockResolvedValue(null as any);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when workspace does not exist", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue(null);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when user is not a member", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue(null);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when role is too low", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue({ role: "Viewer" } as any);
    await expect(requireMember("ws", "Admin")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns workspace + role when authorised", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws-id", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue({ role: "Admin" } as any);
    const result = await requireMember("ws", "Admin");
    expect(result.workspace.id).toBe("ws-id");
    expect(result.role).toBe("Admin");
    expect(result.userId).toBe("u1");
  });
});
```

Run:

```bash
pnpm --filter @evo/web test
```

Expected: FAIL — module './tenancy' not found.

- [ ] **Step 2: Implement tenancy.ts**

`apps/web/src/lib/tenancy.ts`:

```typescript
import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { ForbiddenError } from "@evo/shared";
import type { WorkspaceRole } from "@evo/db";

const RANK: Record<WorkspaceRole, number> = {
  Viewer: 1,
  Agent: 2,
  Admin: 3,
  Owner: 4,
};

export async function requireMember(slug: string, minRole: WorkspaceRole) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new ForbiddenError("Not signed in");

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) throw new ForbiddenError("Workspace not found");

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
  });
  if (!membership) throw new ForbiddenError("Not a member");

  if (RANK[membership.role] < RANK[minRole]) {
    throw new ForbiddenError("Insufficient role");
  }
  return { workspace, role: membership.role, userId };
}
```

Re-run tests:

```bash
pnpm --filter @evo/web test
```

Expected: PASS.

- [ ] **Step 3: POST /api/workspaces (create workspace + owner)**

`apps/web/src/app/api/workspaces/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { auth } from "@/lib/auth";
import { toSlug } from "@evo/shared";

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().default("Asia/Kuala_Lumpur"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
  }

  let slug = toSlug(parsed.data.name);
  // ensure unique slug
  let attempt = 0;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${toSlug(parsed.data.name)}-${attempt}`;
    if (attempt > 50) {
      return NextResponse.json({ error: "SLUG_UNAVAILABLE" }, { status: 409 });
    }
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.name,
      slug,
      timezone: parsed.data.timezone,
      members: { create: { userId: session.user.id, role: "Owner" } },
    },
  });
  return NextResponse.json({ workspace }, { status: 201 });
}
```

- [ ] **Step 4: Onboarding page**

`apps/web/src/app/onboarding/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function OnboardingPage() {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    const { workspace } = await res.json();
    router.push(`/${workspace.slug}/dashboard`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={onSubmit} className="w-full max-w-md p-8 bg-white shadow rounded space-y-4">
        <h1 className="text-xl font-semibold">{t("onboarding.title")}</h1>
        <input className="w-full border rounded p-2" placeholder={t("onboarding.workspaceName")} value={name} onChange={(e) => setName(e.target.value)} required />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={busy} className="w-full bg-black text-white rounded p-2">{t("onboarding.create")}</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
pnpm --filter @evo/web test
git add apps/web/src/lib/tenancy.ts apps/web/src/lib/tenancy.test.ts apps/web/src/app/onboarding apps/web/src/app/api/workspaces
git commit -m "feat(web): onboarding + create-workspace API + requireMember helper"
```

Expected: tests PASS.

---

### Task 11: Workspace layout + dashboard placeholder

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/layout.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/dashboard/page.tsx`

- [ ] **Step 1: Workspace layout that guards access via requireMember**

`apps/web/src/app/[workspaceSlug]/layout.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ForbiddenError } from "@evo/shared";
import { requireMember } from "@/lib/tenancy";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  try {
    await requireMember(workspaceSlug, "Viewer");
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/sign-in");
    notFound();
  }
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-gray-100 p-4 space-y-2">
        <Link href={`/${workspaceSlug}/dashboard`} className="block font-semibold">Dashboard</Link>
        <Link href={`/${workspaceSlug}/settings/members`} className="block">Members</Link>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Dashboard page**

`apps/web/src/app/[workspaceSlug]/dashboard/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
      <p className="mt-2">{t("dashboard.welcome", { workspace: workspace.name })}</p>
    </div>
  );
}
```

- [ ] **Step 3: Manual check**

```bash
pnpm --filter @evo/web dev
```

Sign up → create workspace → arrive at `/<slug>/dashboard`. Expected: welcome message renders with the workspace name.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/'[workspaceSlug]'
git commit -m "feat(web): workspace layout with tenancy guard + dashboard placeholder"
```

---

### Task 12: Invitations — create, accept, list

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/invitations/route.ts`
- Create: `apps/web/src/app/api/invitations/[token]/accept/route.ts`
- Create: `apps/web/src/app/(auth)/accept-invite/[token]/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/settings/layout.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/settings/members/page.tsx`
- Create: `apps/web/src/app/api/workspaces/[slug]/members/[memberId]/route.ts`

- [ ] **Step 1: POST/GET invitations (Admin+)**

`apps/web/src/app/api/workspaces/[slug]/invitations/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["Admin", "Agent", "Viewer"]),
});

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function newToken() {
  return randomBytes(24).toString("base64url");
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }
    const db = tenantClient(workspace.id);
    const invitation = await db.invitation.create({
      data: {
        email: parsed.data.email,
        role: parsed.data.role,
        token: newToken(),
        expiresAt: new Date(Date.now() + EXPIRY_MS),
      } as any,
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const invitations = await db.invitation.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invitations });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: Accept-invite route**

`apps/web/src/app/api/invitations/[token]/accept/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { auth } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "INVALID_OR_EXPIRED" }, { status: 410 });
  }

  // create membership + mark accepted in a transaction
  const [member, workspace] = await prisma.$transaction([
    prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: session.user.id } },
      create: { workspaceId: invitation.workspaceId, userId: session.user.id, role: invitation.role },
      update: {},
    }),
    prisma.workspace.findUnique({ where: { id: invitation.workspaceId } }),
  ]);
  await prisma.invitation.update({ where: { token }, data: { acceptedAt: new Date() } });
  return NextResponse.json({ workspaceSlug: workspace?.slug, role: member.role });
}
```

- [ ] **Step 3: Accept-invite page**

`apps/web/src/app/(auth)/accept-invite/[token]/page.tsx`:

```tsx
"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
    if (res.status === 403) {
      router.push(`/sign-in?next=/accept-invite/${token}`);
      return;
    }
    if (!res.ok) {
      setError(t("invite.expired"));
      setBusy(false);
      return;
    }
    const { workspaceSlug } = await res.json();
    router.push(`/${workspaceSlug}/dashboard`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("invite.acceptTitle", { workspace: "this workspace" })}</h1>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button disabled={busy} onClick={accept} className="w-full bg-black text-white rounded p-2">{t("invite.accept")}</button>
    </div>
  );
}
```

- [ ] **Step 4: Settings layout**

`apps/web/src/app/[workspaceSlug]/settings/layout.tsx`:

```tsx
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="max-w-2xl">{children}</div>;
}
```

- [ ] **Step 5: Members page (server component fetches members + invitations, client form invites)**

`apps/web/src/app/[workspaceSlug]/settings/members/page.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import InviteForm from "./invite-form";
import RemoveButton from "./remove-button";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace, userId } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const members = await db.workspaceMember.findMany({
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invitations = await db.invitation.findMany({
    where: { acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold mb-2">{t("members.title")}</h1>
        <ul className="border rounded divide-y">
          {members.map((m) => (
            <li key={m.id} className="p-3 flex justify-between items-center">
              <span>
                {m.user.name} ({m.user.email}) — <em>{m.role}</em>
                {m.userId === userId && ` ${t("members.you")}`}
              </span>
              {m.role !== "Owner" && m.userId !== userId && (
                <RemoveButton workspaceSlug={workspaceSlug} memberId={m.id} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">{t("members.inviteHeading")}</h2>
        <InviteForm workspaceSlug={workspaceSlug} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">{t("members.pendingInvitations")}</h2>
        <ul className="border rounded divide-y">
          {invitations.map((inv) => (
            <li key={inv.id} className="p-3">
              {inv.email} — {inv.role} — <code className="text-xs">{inv.token}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: InviteForm + RemoveButton client components**

`apps/web/src/app/[workspaceSlug]/settings/members/invite-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function InviteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"Admin" | "Agent" | "Viewer">("Agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    setEmail("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <input className="flex-1 border rounded p-2" type="email" placeholder={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <select className="border rounded p-2" value={role} onChange={(e) => setRole(e.target.value as any)}>
        <option value="Admin">{t("members.roleAdmin")}</option>
        <option value="Agent">{t("members.roleAgent")}</option>
        <option value="Viewer">{t("members.roleViewer")}</option>
      </select>
      <button disabled={busy} className="bg-black text-white rounded p-2 px-4">{t("common.invite")}</button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  );
}
```

`apps/web/src/app/[workspaceSlug]/settings/members/remove-button.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function RemoveButton({ workspaceSlug, memberId }: { workspaceSlug: string; memberId: string }) {
  const t = useTranslations();
  const router = useRouter();
  async function onClick() {
    if (!confirm(`${t("members.remove")}?`)) return;
    await fetch(`/api/workspaces/${workspaceSlug}/members/${memberId}`, { method: "DELETE" });
    router.refresh();
  }
  return <button onClick={onClick} className="text-red-600 text-sm underline">{t("members.remove")}</button>;
}
```

- [ ] **Step 7: DELETE member route**

`apps/web/src/app/api/workspaces/[slug]/members/[memberId]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; memberId: string }> }
) {
  const { slug, memberId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const member = await db.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (member.role === "Owner") return NextResponse.json({ error: "CANNOT_REMOVE_OWNER" }, { status: 409 });
    await db.workspaceMember.delete({ where: { id: memberId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 8: Commit**

```bash
pnpm --filter @evo/web typecheck
git add apps/web/src
git commit -m "feat(web): invitations + members CRUD"
```

Expected: typecheck PASS.

---

### Task 13: `worker` skeleton

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@evo/worker",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@evo/db": "workspace:*",
    "@evo/shared": "workspace:*",
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

- [ ] **Step 2: tsconfig**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: index.ts (heartbeat + /healthz on :4100)**

`apps/worker/src/index.ts`:

```typescript
import http from "node:http";
import pino from "pino";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));

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

setInterval(() => log.info("worker heartbeat"), 60000);
```

- [ ] **Step 4: Verify it boots, commit**

```bash
pnpm install
pnpm --filter @evo/worker dev
```

Then in another terminal: `curl localhost:4100/healthz` → `{"ok":true}`. Stop the dev server.

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): skeleton process with /healthz"
```

---

### Task 14: `ingest` skeleton with stub webhook route

**Files:**
- Create: `apps/ingest/package.json`
- Create: `apps/ingest/tsconfig.json`
- Create: `apps/ingest/src/index.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@evo/ingest",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@evo/db": "workspace:*",
    "@evo/shared": "workspace:*",
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

- [ ] **Step 2: tsconfig**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: index.ts (healthz + stub webhook that 200s)**

`apps/ingest/src/index.ts`:

```typescript
import http from "node:http";
import pino from "pino";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url?.startsWith("/whatsapp/webhook/") && req.method === "POST") {
    // skeleton: read + log + 200. Real ingestion in Plan 2.
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    log.info({ path: req.url, bytes: Buffer.concat(chunks).length }, "webhook stub received");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, stub: true }));
    return;
  }
  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => log.info({ port }, "ingest started"));
```

- [ ] **Step 4: Verify it boots, commit**

```bash
pnpm --filter @evo/ingest dev
```

In another terminal: `curl -X POST -d '{}' localhost:4000/whatsapp/webhook/abc/def -H 'content-type: application/json'`. Expected: `{"ok":true,"stub":true}`. Stop the dev server.

```bash
git add apps/ingest pnpm-lock.yaml
git commit -m "feat(ingest): skeleton process with /healthz + stub webhook"
```

---

### Task 15: Dockerfiles + extend docker-compose

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/ingest/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: web Dockerfile (multi-stage)**

`apps/web/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/web build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
COPY --from=base /app /app
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
```

- [ ] **Step 2: worker Dockerfile**

`apps/worker/Dockerfile`:

```dockerfile
FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/worker build
EXPOSE 4100
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
```

- [ ] **Step 3: ingest Dockerfile**

`apps/ingest/Dockerfile` (same pattern, port 4000):

```dockerfile
FROM node:20-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/ingest ./apps/ingest
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @evo/db generate
RUN pnpm --filter @evo/ingest build
EXPOSE 4000
WORKDIR /app/apps/ingest
CMD ["pnpm", "start"]
```

- [ ] **Step 4: Extend docker-compose.yml with app services + caddy**

Replace `docker-compose.yml` with:

```yaml
name: evolution-manager
services:
  postgres-manager:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: manager
      POSTGRES_PASSWORD: manager
      POSTGRES_DB: evolution_manager
    ports: ["5432:5432"]
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

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      DATABASE_URL: postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public
      REDIS_URL: redis://redis-manager:6379/0
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: ${AUTH_URL}
      DEFAULT_LOCALE: en-GB
    depends_on:
      postgres-manager: { condition: service_healthy }
      redis-manager: { condition: service_healthy }
    ports: ["3000:3000"]

  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      DATABASE_URL: postgresql://manager:manager@postgres-manager:5432/evolution_manager?schema=public
      REDIS_URL: redis://redis-manager:6379/0
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
  caddy-data:
  caddy-config:
```

- [ ] **Step 5: Verify full stack builds + boots**

```bash
docker compose build
docker compose up -d
docker compose ps
```

Expected: postgres-manager, redis-manager healthy; web, worker, ingest, caddy running.

Verify:

```bash
curl -i http://localhost:3000/sign-in     # 200
curl -i http://localhost:4000/healthz     # 200
curl -i http://localhost:80               # 308 → /sign-in via Caddy
```

- [ ] **Step 6: Commit**

```bash
git add apps/*/Dockerfile docker-compose.yml
git commit -m "feat(infra): Dockerfiles + docker-compose for web/worker/ingest/caddy"
```

---

### Task 16: Playwright e2e — full sign-up → workspace → invite → accept

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `tests/e2e/auth-and-workspace.spec.ts`
- Create: `tests/e2e/playwright.helpers.ts`
- Modify: `apps/web/package.json` (add `playwright install` script)

- [ ] **Step 1: playwright config**

`apps/web/playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../tests/e2e",
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @evo/web dev",
        port: 3000,
        reuseExistingServer: true,
        timeout: 60000,
      },
});
```

- [ ] **Step 2: Test helpers (unique emails per run, fresh DB state)**

`tests/e2e/playwright.helpers.ts`:

```typescript
import { execSync } from "node:child_process";

export function freshEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
}

export function resetDb() {
  execSync(
    "pnpm --filter @evo/db exec prisma migrate reset --force --skip-seed",
    { stdio: "inherit", env: { ...process.env } }
  );
}
```

- [ ] **Step 3: Write the failing test**

`tests/e2e/auth-and-workspace.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { freshEmail, resetDb } from "./playwright.helpers";

test.beforeAll(() => {
  resetDb();
});

test("user signs up, creates workspace, invites teammate, teammate accepts", async ({ browser }) => {
  const ownerEmail = freshEmail("owner");
  const agentEmail = freshEmail("agent");
  const pw = "hunter22hunter";

  // Owner: sign up
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await owner.goto("/sign-up");
  await owner.getByPlaceholder("Name").fill("Eman");
  await owner.getByPlaceholder("Email").fill(ownerEmail);
  await owner.getByPlaceholder("Password").fill(pw);
  await owner.getByRole("button", { name: /Create account/i }).click();

  // Onboarding: create workspace
  await owner.waitForURL("**/onboarding");
  await owner.getByPlaceholder("Workspace name").fill("St John's Clinic");
  await owner.getByRole("button", { name: /Create workspace/i }).click();

  // Dashboard
  await owner.waitForURL("**/dashboard");
  await expect(owner.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  await expect(owner.getByText("Welcome to St John's Clinic")).toBeVisible();

  // Invite agent
  const slugMatch = owner.url().match(/\/([^/]+)\/dashboard/);
  const slug = slugMatch![1];
  await owner.goto(`/${slug}/settings/members`);
  await owner.getByPlaceholder("Email").fill(agentEmail);
  await owner.locator("select").selectOption("Agent");
  await owner.getByRole("button", { name: /Invite/i }).click();

  // Read the invitation token from the DOM (rendered as <code>)
  const token = await owner.locator("code").first().textContent();
  expect(token).toBeTruthy();

  // Agent: sign up, then accept invite link
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await agent.goto("/sign-up");
  await agent.getByPlaceholder("Name").fill("Aisha");
  await agent.getByPlaceholder("Email").fill(agentEmail);
  await agent.getByPlaceholder("Password").fill(pw);
  await agent.getByRole("button", { name: /Create account/i }).click();
  await agent.waitForURL("**/onboarding");

  // Visit the invite link
  await agent.goto(`/accept-invite/${token}`);
  await agent.getByRole("button", { name: /Accept invitation/i }).click();
  await agent.waitForURL(`**/${slug}/dashboard`);
  await expect(agent.getByText("Welcome to St John's Clinic")).toBeVisible();
});
```

- [ ] **Step 4: Install Playwright browsers**

```bash
pnpm --filter @evo/web exec playwright install chromium
```

- [ ] **Step 5: Run the test**

Start the dev stack first (db must be up):

```bash
docker compose up -d postgres-manager redis-manager
pnpm --filter @evo/db exec prisma migrate deploy
pnpm --filter @evo/web test:e2e
```

Expected: test PASSES end-to-end.

- [ ] **Step 6: Commit**

```bash
git add apps/web/playwright.config.ts tests/e2e
git commit -m "test(e2e): full sign-up + workspace + invite + accept happy path"
```

---

### Task 17: README + ops notes

**Files:**
- Create: `README.md`
- Create: `docs/ops/runbook.md`

- [ ] **Step 1: README**

`README.md`:

```markdown
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
```

- [ ] **Step 2: Ops runbook**

`docs/ops/runbook.md`:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ops/runbook.md
git commit -m "docs: README and ops runbook for Plan 0 baseline"
```

---

## Plan 0 verification checklist

Run after Task 17:

- [ ] `pnpm install` succeeds from a clean checkout.
- [ ] `pnpm typecheck` passes across all packages.
- [ ] `pnpm test` passes (vitest unit tests).
- [ ] `pnpm --filter @evo/web test:e2e` passes (Playwright happy path).
- [ ] `docker compose up -d --build` brings the full stack up with all containers healthy.
- [ ] `curl http://localhost:3000/sign-in` returns 200.
- [ ] `curl http://localhost:4000/healthz` returns 200.
- [ ] `curl http://localhost` (via Caddy) returns the sign-in page.

When all checked: Plan 0 is done. Move to Plan 1 (Instances + send pipeline).
