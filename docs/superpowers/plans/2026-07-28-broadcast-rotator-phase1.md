# Broadcast Instance Rotator — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a broadcast blast across a *group* of WhatsApp numbers — either in parallel (each number at its own safe pace) or by rotating one number at a time after N leads — with the group auto-skipping banned/exhausted numbers.

**Architecture:** A new many-to-many `InstanceGroup`/`InstanceGroupMember` pair; four new nullable `Broadcast` columns and one nullable `BroadcastTarget.instanceId`; CRUD routes mirroring the existing `lists` routes; a Groups panel on the Instances page; a "Send from" mode switch in the broadcast wizard; and a branch in the worker scheduler that, in group mode, computes an eligible-number set each tick and assigns each lead to a number (parallel = earliest-free cursor; rotate = sticky N-per-cycle), persisting per-number pacing in a `groupState` JSON. Single-number mode is untouched.

**Tech Stack:** Prisma (Postgres), Next.js 15 app-router API routes + React client components, BullMQ worker, Vitest, Zod. Spec: `docs/superpowers/specs/2026-07-28-broadcast-rotator-and-report-design.md`.

**Conventions to follow:**
- Migrations live in `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`; after editing `schema.prisma` run `pnpm --filter @evo/db exec prisma generate` so types update, then create the SQL migration by hand (all columns nullable/defaulted → additive).
- API routes: `requireMember(slug, "Viewer"|"Admin")`, `tenantClient(workspace.id)`, `AppError` → `{ error: code }` with `e.status`, `isUniqueViolation` → 409 `DUPLICATE_NAME`. Mirror `apps/web/src/app/api/workspaces/[slug]/lists/`.
- Worker tests are DB-backed against `evolution_manager_test`; run with `pnpm --filter @evo/worker test`. Web typecheck: `pnpm --filter @evo/web exec tsc --noEmit`. Worker typecheck: `pnpm --filter @evo/worker exec tsc --noEmit`.
- Commit after each task.

---

## File Structure

**Schema / DB**
- Modify `packages/db/prisma/schema.prisma` — add `InstanceGroup`, `InstanceGroupMember`; add columns to `Broadcast` and `BroadcastTarget`; back-relations on `Instance` and `Workspace`.
- Create `packages/db/prisma/migrations/20260728100000_instance_groups/migration.sql`.
- Modify `packages/db/src/tenant.ts` — add `"InstanceGroup"` to `TENANTED_MODELS`.

**API**
- Create `apps/web/src/app/api/workspaces/[slug]/instance-groups/route.ts` — GET list, POST create.
- Create `apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/route.ts` — GET, PUT (rename), DELETE.
- Create `apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/members/route.ts` — POST add, DELETE remove.
- Modify `apps/web/src/app/api/workspaces/[slug]/broadcasts/route.ts` — accept + validate group fields.

**Web UI**
- Create `apps/web/src/app/[workspaceSlug]/instances/groups-panel.tsx` — client Groups manager.
- Modify `apps/web/src/app/[workspaceSlug]/instances/page.tsx` — load groups, render the panel.
- Modify `apps/web/src/app/[workspaceSlug]/broadcasts/new/page.tsx` — load groups, pass to wizard.
- Modify `apps/web/src/app/[workspaceSlug]/broadcasts/new/wizard.tsx` — Send-from mode switch + group-aware estimate.

**Worker**
- Modify `apps/worker/src/broadcast-scheduler.ts` — group-mode branch + assignment helpers.
- Modify `apps/worker/src/broadcast-scheduler.test.ts` — group tests.

---

## Task 1: Schema — groups, broadcast group fields, target instanceId

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260728100000_instance_groups/migration.sql`
- Modify: `packages/db/src/tenant.ts`

- [ ] **Step 1: Add the two new models to `schema.prisma`** (place after the `Instance` model block)

```prisma
model InstanceGroup {
  id          String                @id @default(cuid())
  workspaceId String
  name        String
  createdAt   DateTime              @default(now())
  updatedAt   DateTime              @updatedAt
  workspace   Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  members     InstanceGroupMember[]
  broadcasts  Broadcast[]
  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model InstanceGroupMember {
  groupId    String
  instanceId String
  group      InstanceGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  instance   Instance      @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  @@id([groupId, instanceId])
  @@index([instanceId])
}
```

- [ ] **Step 2: Add back-relations**

In `model Instance { … }` add:
```prisma
  groupMemberships InstanceGroupMember[]
```
In `model Workspace { … }` add:
```prisma
  instanceGroups InstanceGroup[]
```

- [ ] **Step 3: Add the `Broadcast` columns** (next to `fallbackInstanceIds`)

```prisma
  instanceGroupId String?
  groupSendMode   String?
  rotateEvery     Int?
  groupState      Json?
  instanceGroup   InstanceGroup? @relation(fields: [instanceGroupId], references: [id], onDelete: SetNull)
```

- [ ] **Step 4: Add the `BroadcastTarget` column** (next to its existing `status`/`error` fields)

```prisma
  instanceId String?
```

- [ ] **Step 5: Register `InstanceGroup` as tenant-scoped** in `packages/db/src/tenant.ts` — add the line inside the `TENANTED_MODELS` set (after `"Instance",`):

```ts
  "InstanceGroup",
```
(Do NOT add `InstanceGroupMember` — it has no `workspaceId`; it is always reached through a tenant-scoped group.)

- [ ] **Step 6: Write the migration SQL**

`packages/db/prisma/migrations/20260728100000_instance_groups/migration.sql`:
```sql
-- Instance groups (many-to-many) + broadcast group/rotation fields + per-target sender.
CREATE TABLE "InstanceGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstanceGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstanceGroup_workspaceId_name_key" ON "InstanceGroup"("workspaceId", "name");
CREATE INDEX "InstanceGroup_workspaceId_idx" ON "InstanceGroup"("workspaceId");
ALTER TABLE "InstanceGroup" ADD CONSTRAINT "InstanceGroup_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstanceGroupMember" (
    "groupId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    CONSTRAINT "InstanceGroupMember_pkey" PRIMARY KEY ("groupId", "instanceId")
);
CREATE INDEX "InstanceGroupMember_instanceId_idx" ON "InstanceGroupMember"("instanceId");
ALTER TABLE "InstanceGroupMember" ADD CONSTRAINT "InstanceGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "InstanceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstanceGroupMember" ADD CONSTRAINT "InstanceGroupMember_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Broadcast" ADD COLUMN "instanceGroupId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "groupSendMode" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "rotateEvery" INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN "groupState" JSONB;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_instanceGroupId_fkey"
    FOREIGN KEY ("instanceGroupId") REFERENCES "InstanceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BroadcastTarget" ADD COLUMN "instanceId" TEXT;
```

- [ ] **Step 7: Regenerate the client and apply the migration to the test DB**

Run:
```bash
pnpm --filter @evo/db exec prisma generate
pnpm --filter @evo/db exec prisma migrate deploy
```
Expected: generate succeeds; migrate reports `20260728100000_instance_groups` applied (or "No pending" if already applied by a prior run).

- [ ] **Step 8: Verify typecheck across db consumers**

Run: `pnpm --filter @evo/worker exec tsc --noEmit && pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0 (the new fields exist on the generated types; nothing references them yet).

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260728100000_instance_groups packages/db/src/tenant.ts
git commit -m "feat(db): instance groups (m2m) + broadcast group/rotation fields + target sender"
```

---

## Task 2: Instance-groups CRUD API (list/create/rename/delete)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instance-groups/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/route.ts`

- [ ] **Step 1: Create the collection route** `apps/web/src/app/api/workspaces/[slug]/instance-groups/route.ts`

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { isUniqueViolation } from "@/lib/prisma-errors";

const schema = z.object({ name: z.string().min(1).max(120) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const groups = await db.instanceGroup.findMany({
      include: { members: { select: { instanceId: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ groups });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.create({ data: parsed.data as any });
    return NextResponse.json({ group }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (isUniqueViolation(e)) return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    throw e;
  }
}
```

- [ ] **Step 2: Create the item route** `apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/route.ts`

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { isUniqueViolation } from "@/lib/prisma-errors";

const schema = z.object({ name: z.string().min(1).max(120) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.findUnique({
      where: { id },
      include: { members: { select: { instanceId: true } } },
    });
    if (!group) throw new NotFoundError("Group not found");
    return NextResponse.json({ group });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.update({ where: { id }, data: { name: parsed.data.name } });
    return NextResponse.json({ group });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (isUniqueViolation(e)) return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    await db.instanceGroup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/instance-groups/route.ts" "apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/route.ts"
git commit -m "feat(api): instance-groups CRUD (list/create/rename/delete)"
```

---

## Task 3: Group members API (add/remove)

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/members/route.ts`

- [ ] **Step 1: Create the members route**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({ instanceIds: z.array(z.string()).min(1).max(100) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundError("Group not found");
    // Only add numbers that belong to this workspace (tenantClient scopes the lookup).
    const owned = await db.instance.findMany({ where: { id: { in: parsed.data.instanceIds } }, select: { id: true } });
    if (owned.length !== parsed.data.instanceIds.length) {
      return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 400 });
    }
    await db.instanceGroupMember.createMany({
      data: owned.map((i) => ({ groupId: id, instanceId: i.id })),
      skipDuplicates: true,
    } as any);
    return NextResponse.json({ ok: true, added: owned.length });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const group = await db.instanceGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundError("Group not found");
    await db.instanceGroupMember.deleteMany({
      where: { groupId: id, instanceId: { in: parsed.data.instanceIds } },
    } as any);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

Note: `instanceGroupMember` is not a tenant model, but every call first loads the parent `group` via `tenantClient` (throwing 404 if it isn't this workspace's) and validates instance ownership — so it is never reachable cross-tenant.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/instance-groups/[id]/members/route.ts"
git commit -m "feat(api): add/remove instance-group members"
```

---

## Task 4: Groups panel on the Instances page

**Files:**
- Create: `apps/web/src/app/[workspaceSlug]/instances/groups-panel.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/instances/page.tsx`

- [ ] **Step 1: Create the client panel** `apps/web/src/app/[workspaceSlug]/instances/groups-panel.tsx`

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Trash2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type InstanceRow = { id: string; label: string; connectionState: string };
type GroupRow = { id: string; name: string; memberIds: string[] };

export default function GroupsPanel({
  workspaceSlug,
  instances,
  initialGroups,
}: {
  workspaceSlug: string;
  instances: InstanceRow[];
  initialGroups: GroupRow[];
}) {
  const router = useRouter();
  const base = `/api/workspaces/${workspaceSlug}/instance-groups`;
  const [groups, setGroups] = useState<GroupRow[]>(initialGroups);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError(null);
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error === "DUPLICATE_NAME" ? "A group with that name already exists." : "Could not create group.");
      return;
    }
    const { group } = await res.json();
    setGroups((g) => [...g, { id: group.id, name: group.name, memberIds: [] }]);
    setNewName("");
    router.refresh();
  }

  async function toggleMember(group: GroupRow, instanceId: string) {
    const has = group.memberIds.includes(instanceId);
    setGroups((gs) => gs.map((g) => g.id === group.id
      ? { ...g, memberIds: has ? g.memberIds.filter((x) => x !== instanceId) : [...g.memberIds, instanceId] }
      : g));
    await fetch(`${base}/${group.id}/members`, {
      method: has ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceIds: [instanceId] }),
    }).catch(() => {});
  }

  async function deleteGroup(group: GroupRow) {
    if (!confirm(`Delete group "${group.name}"? Numbers are not deleted.`)) return;
    setGroups((gs) => gs.filter((g) => g.id !== group.id));
    await fetch(`${base}/${group.id}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Number groups</h2>
        </div>
        <p className="text-sm text-muted-foreground">Group numbers so a broadcast can blast across the whole group (in parallel or rotating one at a time).</p>

        <form onSubmit={createGroup} className="flex items-center gap-2">
          <input className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="New group name (e.g. Blast Collection)…" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} />
          <Button type="submit" disabled={busy || !newName.trim()}><Plus className="h-4 w-4 mr-1" /> Create</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{g.name} <span className="text-xs text-muted-foreground">· {g.memberIds.length} number{g.memberIds.length === 1 ? "" : "s"}</span></p>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => deleteGroup(g)} title="Delete group">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {instances.map((inst) => (
                    <label key={inst.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={g.memberIds.includes(inst.id)} onChange={() => toggleMember(g, inst.id)} />
                      <span>{inst.label}</span>
                      <span className={`ml-auto text-xs ${inst.connectionState === "open" ? "text-success" : "text-muted-foreground"}`}>{inst.connectionState}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Load groups + render the panel in `instances/page.tsx`**

After the existing `const instances = await db.instance.findMany(...)`, add:
```tsx
  const groups = await db.instanceGroup.findMany({
    include: { members: { select: { instanceId: true } } },
    orderBy: { name: "asc" },
  });
```
Add the import at the top:
```tsx
import GroupsPanel from "./groups-panel";
```
Then render the panel inside the page's root `<div className="space-y-4">`, after the instances list (before the closing `</div>`):
```tsx
      <GroupsPanel
        workspaceSlug={workspaceSlug}
        instances={instances.map((i) => ({ id: i.id, label: i.label, connectionState: i.connectionState }))}
        initialGroups={groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.members.map((m) => m.instanceId) }))}
      />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/instances/groups-panel.tsx" "apps/web/src/app/[workspaceSlug]/instances/page.tsx"
git commit -m "feat(ui): number-groups manager on the Instances page"
```

---

## Task 5: Broadcast create route accepts + validates group fields

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[slug]/broadcasts/route.ts`

- [ ] **Step 1: Extend the create schema** — add these keys to the `createSchema` object (after `fallbackInstanceIds`):

```ts
  instanceGroupId: z.string().optional().nullable(),
  groupSendMode: z.enum(["parallel", "rotate"]).optional(),
  rotateEvery: z.number().int().min(1).max(10000).optional(),
```

- [ ] **Step 2: Validate + resolve the group in the POST handler.** After the existing block that verifies `instance` exists (`const instance = await db.instance.findUnique(...)`), insert:

```ts
    // Group mode: verify the group belongs to this workspace and has ≥1 member.
    // instanceId stays required (a valid FK for display) — set it to the first member.
    let primaryInstanceId = parsed.data.instanceId;
    if (parsed.data.instanceGroupId) {
      const group = await db.instanceGroup.findUnique({
        where: { id: parsed.data.instanceGroupId },
        include: { members: { select: { instanceId: true } } },
      });
      if (!group) return NextResponse.json({ error: "GROUP_NOT_FOUND" }, { status: 400 });
      if (group.members.length === 0) return NextResponse.json({ error: "GROUP_EMPTY" }, { status: 400 });
      if (!parsed.data.groupSendMode) return NextResponse.json({ error: "GROUP_MODE_REQUIRED" }, { status: 400 });
      primaryInstanceId = group.members[0]!.instanceId;
    }
```

- [ ] **Step 3: Persist the group fields on create.** In the `db.broadcast.create({ data: { … } })` call, change `instanceId: parsed.data.instanceId` to `instanceId: primaryInstanceId`, and add:

```ts
        instanceGroupId: parsed.data.instanceGroupId ?? null,
        groupSendMode: parsed.data.instanceGroupId ? parsed.data.groupSendMode : null,
        rotateEvery: parsed.data.instanceGroupId && parsed.data.groupSendMode === "rotate" ? (parsed.data.rotateEvery ?? 20) : null,
```
Also, in group mode ignore single-mode failover — change `fallbackInstanceIds: parsed.data.fallbackInstanceIds` to:
```ts
        fallbackInstanceIds: parsed.data.instanceGroupId ? [] : parsed.data.fallbackInstanceIds,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[slug]/broadcasts/route.ts"
git commit -m "feat(api): broadcast create accepts group + rotation settings"
```

---

## Task 6: Wizard — Send-from single/group switch + group-aware estimate

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/broadcasts/new/page.tsx`
- Modify: `apps/web/src/app/[workspaceSlug]/broadcasts/new/wizard.tsx`

- [ ] **Step 1: Load groups in `new/page.tsx` and pass to the wizard.** After the query that loads instances/lists, add a groups query (only groups with ≥1 member are useful):

```tsx
  const groups = await db.instanceGroup.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });
```
Pass to `<Wizard … groups={groups.filter((g) => g._count.members > 0).map((g) => ({ id: g.id, name: g.name, memberCount: g._count.members }))} />`.

- [ ] **Step 2: Extend the wizard's props** in `wizard.tsx` — add to the props type and destructure:

```tsx
  groups = [],
}: {
  // …existing props…
  groups?: { id: string; name: string; memberCount: number }[];
}) {
```
(Insert `groups?: …` into the existing props type object, and `groups = []` into the destructured params.)

- [ ] **Step 3: Add send-from state** (near the existing `instanceId`/`fallbackInstanceIds` state):

```tsx
  const [sendFrom, setSendFrom] = useState<"single" | "group">("single");
  const [instanceGroupId, setInstanceGroupId] = useState(groups[0]?.id ?? "");
  const [groupSendMode, setGroupSendMode] = useState<"parallel" | "rotate">("parallel");
  const [rotateEvery, setRotateEvery] = useState(20);
  const selectedGroup = groups.find((g) => g.id === instanceGroupId);
```

- [ ] **Step 4: Render the Send-from switch.** Replace the existing "pick instance" `<label>` + "Backup numbers" `<Card>` block with a mode switch that shows the single-number controls OR the group controls:

```tsx
      <div className="flex gap-2">
        <button type="button" onClick={() => setSendFrom("single")}
          className={`flex-1 rounded border p-2 text-sm ${sendFrom === "single" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          Single number
        </button>
        <button type="button" onClick={() => setSendFrom("group")} disabled={groups.length === 0}
          className={`flex-1 rounded border p-2 text-sm disabled:opacity-40 ${sendFrom === "group" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          Group {groups.length === 0 ? "(none yet)" : ""}
        </button>
      </div>

      {sendFrom === "single" ? (
        <>
          {/* existing "pick instance" <label> select goes here */}
          {/* existing Backup-numbers <Card> goes here */}
        </>
      ) : (
        <Card className="p-3 space-y-2">
          <label className="block">
            <span className="text-sm">Group</span>
            <select className="w-full border rounded p-2 mt-1" value={instanceGroupId} onChange={(e) => setInstanceGroupId(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setGroupSendMode("parallel")}
              className={`flex-1 rounded border p-2 text-sm ${groupSendMode === "parallel" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
              Parallel (all numbers at once)
            </button>
            <button type="button" onClick={() => setGroupSendMode("rotate")}
              className={`flex-1 rounded border p-2 text-sm ${groupSendMode === "rotate" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
              One at a time (rotate)
            </button>
          </div>
          {groupSendMode === "rotate" && (
            <label className="block">
              <span className="text-sm">Rotate after (messages per number)</span>
              <input type="number" className="w-full border rounded p-2 mt-1" value={rotateEvery}
                onChange={(e) => setRotateEvery(Math.max(1, Number(e.target.value) || 1))} min={1} max={10000} />
            </label>
          )}
        </Card>
      )}
```
Keep the existing `instanceId` select as the single-mode control inside the `sendFrom === "single"` branch.

- [ ] **Step 5: Make the estimate group-aware.** Find the existing estimate computation (`estMinLabel`/`estMaxLabel` from `estimatedRecipients * effMin/effMax`). Divide by the parallel fan-out:

```tsx
  const parallelFactor = sendFrom === "group" && groupSendMode === "parallel" && selectedGroup ? Math.max(1, selectedGroup.memberCount) : 1;
  const estMinLabel = formatDuration((estimatedRecipients * effMin) / parallelFactor);
  const estMaxLabel = formatDuration((estimatedRecipients * effMax) / parallelFactor);
```
(Replace the two existing `formatDuration(...)` lines. Rotate and single keep `parallelFactor = 1`.)

- [ ] **Step 6: Send the group fields in the create body.** In `submit()`, add to the JSON body:

```tsx
        instanceGroupId: sendFrom === "group" ? instanceGroupId : undefined,
        groupSendMode: sendFrom === "group" ? groupSendMode : undefined,
        rotateEvery: sendFrom === "group" && groupSendMode === "rotate" ? rotateEvery : undefined,
```
And guard: when `sendFrom === "group"`, don't send `fallbackInstanceIds` (send `[]`). The route already ignores them in group mode, but keep the body clean:
```tsx
        fallbackInstanceIds: sendFrom === "group" ? [] : fallbackInstanceIds.filter((id) => id !== instanceId),
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @evo/web exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/[workspaceSlug]/broadcasts/new/page.tsx" "apps/web/src/app/[workspaceSlug]/broadcasts/new/wizard.tsx"
git commit -m "feat(ui): broadcast wizard Send-from single/group + parallel/rotate + estimate"
```

---

## Task 7: Scheduler — group eligibility + parallel/rotate assignment (TDD)

**Files:**
- Modify: `apps/worker/src/broadcast-scheduler.ts`
- Test: `apps/worker/src/broadcast-scheduler.test.ts`

Context — current `runScheduler` (in `broadcast-scheduler.ts`), for each `running` broadcast, does: schedule-window check → single-number failover → `remainingBulkToday` allowance → load `queued` targets (`take`) → per-target cumulative cursor enqueue → persist `nextSlotAt`. This task inserts a **group-mode branch** that replaces the failover + allowance + assignment steps when `b.instanceGroupId` is set. `computeSendDelayMs`, `SCHEDULE_HORIZON_MS`, template rendering, and the completion check are reused unchanged.

- [ ] **Step 1: Write the failing tests** — append to `broadcast-scheduler.test.ts` a new `describe("runScheduler group mode (DB-backed)")` block. Seed helper creates a workspace, N instances, a group with those members, a broadcast with `instanceGroupId` + mode + `intervalMinSec/Max`, and Q queued targets.

```ts
describe("runScheduler group mode (DB-backed)", () => {
  const fakeQueue = { add: vi.fn(async () => undefined) } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.broadcastTarget.deleteMany();
    await prisma.broadcast.deleteMany();
    await prisma.instanceGroupMember.deleteMany();
    await prisma.instanceGroup.deleteMany();
    await prisma.contactListMember.deleteMany();
    await prisma.contactList.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.messageTemplate.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspace.deleteMany();
  });

  async function seedGroup(opts: { mode: "parallel" | "rotate"; states: ("open" | "close")[]; queued: number; rotateEvery?: number }) {
    const uniq = Date.now() + "-" + Math.random();
    const ws = await prisma.workspace.create({ data: { name: "G", slug: "g-" + uniq } });
    const insts = [];
    for (let i = 0; i < opts.states.length; i++) {
      insts.push(await prisma.instance.create({
        data: { workspaceId: ws.id, label: "n" + i, evolutionInstanceName: "evo-" + i + "-" + uniq, evolutionApiKey: "K", connectionState: opts.states[i] },
      }));
    }
    const group = await prisma.instanceGroup.create({ data: { workspaceId: ws.id, name: "grp-" + uniq } });
    await prisma.instanceGroupMember.createMany({ data: insts.map((i) => ({ groupId: group.id, instanceId: i.id })) });
    const list = await prisma.contactList.create({ data: { workspaceId: ws.id, name: "L" } });
    const tpl = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "T", body: "hi {{name}}" } });
    const b = await prisma.broadcast.create({
      data: {
        workspaceId: ws.id, instanceId: insts[0].id, listId: list.id, templateId: tpl.id,
        name: "B", status: "running", createdByUserId: "u",
        intervalMinSec: 45, intervalMaxSec: 90,
        instanceGroupId: group.id, groupSendMode: opts.mode, rotateEvery: opts.rotateEvery ?? null,
      } as any,
    });
    for (let i = 0; i < opts.queued; i++) {
      const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60100" + (10000 + i) } });
      await prisma.broadcastTarget.create({ data: { workspaceId: ws.id, broadcastId: b.id, contactId: c.id, status: "queued" } });
    }
    return { ws, insts, group, broadcast: b };
  }

  it("parallel: distributes across all open members (each target tagged with an instanceId)", async () => {
    const { insts } = await seedGroup({ mode: "parallel", states: ["open", "open"], queued: 6 });
    await runScheduler(fakeQueue);
    const used = new Set(fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId));
    expect(used.size).toBe(2); // both numbers used
    expect([...used].every((id) => insts.some((i) => i.id === id))).toBe(true);
  });

  it("parallel: skips a closed member (only the open number is used)", async () => {
    const { insts } = await seedGroup({ mode: "parallel", states: ["open", "close"], queued: 4 });
    await runScheduler(fakeQueue);
    const used = new Set(fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId));
    expect(used.size).toBe(1);
    expect([...used][0]).toBe(insts[0].id);
  });

  it("rotate: sends rotateEvery on the first number, then switches to the next", async () => {
    const { insts } = await seedGroup({ mode: "rotate", states: ["open", "open"], queued: 5, rotateEvery: 2 });
    await runScheduler(fakeQueue);
    const usedInOrder = fakeQueue.add.mock.calls.map((c: any[]) => c[1].instanceId);
    // First 2 → number A, next 2 → number B, next → number A again (cycle).
    expect(usedInOrder.slice(0, 2).every((id: string) => id === insts[0].id)).toBe(true);
    expect(usedInOrder.slice(2, 4).every((id: string) => id === insts[1].id)).toBe(true);
  });

  it("group failover: re-queues a sending target whose number went offline", async () => {
    const { insts, group, broadcast, ws } = await seedGroup({ mode: "parallel", states: ["open", "open"], queued: 0 });
    // A target already 'sending' on inst[1], which we now mark closed.
    await prisma.instance.update({ where: { id: insts[1].id }, data: { connectionState: "close" } });
    const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60199999999" } });
    const t = await prisma.broadcastTarget.create({ data: { workspaceId: ws.id, broadcastId: broadcast.id, contactId: c.id, status: "sending", instanceId: insts[1].id } });
    await runScheduler(fakeQueue);
    const after = await prisma.broadcastTarget.findUnique({ where: { id: t.id } });
    // Re-queued off the dead number, then possibly re-assigned to the open one this tick.
    expect(after?.status).not.toBe("sending");
    if (after?.status === "sending") expect(after.instanceId).toBe(insts[0].id);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @evo/worker test broadcast-scheduler`
Expected: the 4 new tests FAIL (group mode not implemented — parallel/rotate currently fall through single-mode logic using only `b.instanceId`).

- [ ] **Step 3: Implement the group-mode branch.** In `runScheduler`, right after the schedule-window check (`if (!isWithinSchedule(...)) continue;`) and BEFORE the single-number failover block, insert a group-mode branch. When `b.instanceGroupId` is set, this branch fully handles the broadcast for the tick and `continue`s.

```ts
    if (b.instanceGroupId) {
      const enq = await runGroupTick(sendQueue, b, now);
      enqueued += enq;
      continue;
    }
```

Then add these helpers at the bottom of the file (below `runScheduler`):

```ts
type GroupState = { cursors: Record<string, number>; activeInstanceId: string | null; sentInCycle: number };

async function runGroupTick(
  sendQueue: Queue,
  b: any, // the running broadcast row (includes template)
  now: Date,
): Promise<number> {
  const nowMs = now.getTime();

  // Eligible = group members that are connected AND have ramp allowance left today.
  const memberIds = (
    await prisma.instanceGroupMember.findMany({ where: { groupId: b.instanceGroupId }, select: { instanceId: true } })
  ).map((m) => m.instanceId);
  if (memberIds.length === 0) return 0;

  const instances = await prisma.instance.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, connectionState: true },
  });
  // Preserve membership order for deterministic rotation.
  const orderedOpen = memberIds
    .map((id) => instances.find((i) => i.id === id))
    .filter((i): i is { id: string; connectionState: string } => !!i && i.connectionState === "open");

  const allowance = new Map<string, number | null>();
  for (const inst of orderedOpen) allowance.set(inst.id, await remainingBulkToday(inst.id, now));
  const eligible = orderedOpen.filter((i) => allowance.get(i.id) !== 0); // null = unlimited; 0 = exhausted
  const eligibleIds = new Set(eligible.map((i) => i.id));

  // Group failover: re-queue any in-flight target whose number is no longer eligible.
  await prisma.broadcastTarget.updateMany({
    where: { broadcastId: b.id, status: "sending", instanceId: { notIn: [...eligibleIds] } },
    data: { status: "queued", error: null, instanceId: null },
  });

  if (eligible.length === 0) return 0; // all numbers down/exhausted — defer this tick

  const targets = await prisma.broadcastTarget.findMany({
    where: { broadcastId: b.id, status: "queued" },
    take: BATCH_SIZE,
    include: { contact: true },
  });
  if (targets.length === 0) {
    await maybeCompleteBroadcast(b, now); // same completion logic single mode uses
    return 0;
  }

  const template = b.template?.body ?? "";
  const state: GroupState = (b.groupState as GroupState | null) ?? { cursors: {}, activeInstanceId: null, sentInCycle: 0 };
  const rotateEvery = Math.max(1, b.rotateEvery ?? 20);
  // Local per-instance allowance budget for this tick (don't over-assign to one number).
  const budget = new Map<string, number>();
  for (const i of eligible) { const a = allowance.get(i.id); budget.set(i.id, a == null ? Number.MAX_SAFE_INTEGER : a); }

  // Ensure a valid rotate pointer within the eligible set.
  if (b.groupSendMode === "rotate" && (!state.activeInstanceId || !eligibleIds.has(state.activeInstanceId))) {
    state.activeInstanceId = eligible[0].id;
    state.sentInCycle = 0;
  }

  let enqueued = 0;
  for (const target of targets) {
    // Pick the instance for this lead.
    let instId: string | null = null;
    if (b.groupSendMode === "rotate") {
      // Hop the pointer forward past a completed cycle or an out-of-budget number,
      // at most once around the ring; if nothing has budget, instId stays null.
      for (let hop = 0; hop < eligible.length; hop++) {
        const active = state.activeInstanceId!;
        const cycleDone = state.sentInCycle >= rotateEvery;
        const noBudget = (budget.get(active) ?? 0) <= 0;
        if (cycleDone || noBudget) {
          const idx = eligible.findIndex((i) => i.id === active);
          state.activeInstanceId = eligible[(idx + 1) % eligible.length].id;
          state.sentInCycle = 0;
          continue;
        }
        instId = active;
        break;
      }
    } else {
      // parallel: the eligible number that is free soonest and still has budget.
      const candidates = eligible.filter((i) => (budget.get(i.id) ?? 0) > 0);
      if (candidates.length > 0) {
        candidates.sort((a, c) => (state.cursors[a.id] ?? 0) - (state.cursors[c.id] ?? 0));
        instId = candidates[0].id;
      }
    }
    if (!instId) break; // every eligible number is out of budget this tick

    const gapMs = computeSendDelayMs(b);
    const baseMs = Math.max(nowMs, state.cursors[instId] ?? 0);
    const slotMs = baseMs + gapMs;
    if (slotMs - nowMs > SCHEDULE_HORIZON_MS) break;
    state.cursors[instId] = slotMs;
    budget.set(instId, (budget.get(instId) ?? 0) - 1);
    if (b.groupSendMode === "rotate") state.sentInCycle += 1;

    const c = target.contact;
    const cf = (c.customFields ?? {}) as Record<string, unknown>;
    const text = renderTemplate(template, { name: c.name ?? "", phone: c.phoneE164, contact: { name: c.name ?? "", phone: c.phoneE164 }, ...cf });
    await prisma.broadcastTarget.update({ where: { id: target.id }, data: { status: "sending", instanceId: instId } });
    await sendQueue.add(
      "send",
      { broadcastId: b.id, targetId: target.id, instanceId: instId, to: c.phoneE164, text, mediaAssetId: b.mediaAssetId, workspaceId: b.workspaceId },
      { delay: slotMs - nowMs, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 },
    );
    enqueued += 1;
  }

  await prisma.broadcast.update({ where: { id: b.id }, data: { groupState: state as any } });
  return enqueued;
}
```

- [ ] **Step 4: Extract the completion check into a shared helper** so both modes reuse it. In `broadcast-scheduler.ts`, wrap the existing "targets.length === 0 → complete" logic (the block that sets `status: "completed"` + emits `broadcast.completed`/`broadcast.failed` webhooks) into:

```ts
async function maybeCompleteBroadcast(b: { id: string; name: string; workspaceId: string }, now: Date): Promise<void> {
  const sendingCount = await prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "sending" } });
  if (sendingCount !== 0) return;
  await prisma.broadcast.update({ where: { id: b.id }, data: { status: "completed", completedAt: new Date() } });
  const [sent, failed, total] = await Promise.all([
    prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "sent" } }),
    prisma.broadcastTarget.count({ where: { broadcastId: b.id, status: "failed" } }),
    prisma.broadcastTarget.count({ where: { broadcastId: b.id } }),
  ]);
  const summary = { broadcastId: b.id, name: b.name, sent, failed, total };
  await emitWebhook(b.workspaceId, "broadcast.completed", summary);
  if (failed > 0) await emitWebhook(b.workspaceId, "broadcast.failed", summary);
}
```
Then in the single-mode path, replace the inline completion block with `await maybeCompleteBroadcast(b, now);` (keep the surrounding `continue`).

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @evo/worker test broadcast-scheduler`
Expected: all group-mode tests PASS, and the pre-existing single-mode + failover + pacing tests still PASS.

- [ ] **Step 6: Typecheck the worker**

Run: `pnpm --filter @evo/worker exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/broadcast-scheduler.ts apps/worker/src/broadcast-scheduler.test.ts
git commit -m "feat(broadcast): group-mode scheduler — parallel/rotate assignment + eligibility + group failover"
```

---

## Task 8: Full test + typecheck sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole worker suite**

Run: `pnpm --filter @evo/worker test`
Expected: all tests pass (previous 36 + the 4 new group tests).

- [ ] **Step 2: Typecheck web + worker**

Run: `pnpm --filter @evo/web exec tsc --noEmit && pnpm --filter @evo/worker exec tsc --noEmit`
Expected: exit 0 for both.

- [ ] **Step 3: Commit any lint/format fixes if needed** (otherwise nothing to commit)

---

## Deployment (after all tasks pass, run once)

Group-mode adds a migration + worker logic + web UI. Deploy sequence (matches the repo's prod flow — rsync source, build, migrate, restart):

```bash
E='ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519'; R=emanbukh@167.99.74.213:/home/emanbukh/evolution
rsync -az -e "$E" packages/db/prisma/ "$R/packages/db/prisma/"
rsync -az -e "$E" apps/worker/src/ "$R/apps/worker/src/"
rsync -az -e "$E" apps/web/src/ "$R/apps/web/src/"
ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 emanbukh@167.99.74.213 'cd /home/emanbukh/evolution && docker compose build web worker'
# IMPORTANT: run migrate deploy from a FRESHLY BUILT image (the web image must contain the new migration file):
ssh … 'cd /home/emanbukh/evolution && docker compose run --rm --no-deps web sh -c "cd /app/packages/db && pnpm exec prisma migrate deploy"'
ssh … 'cd /home/emanbukh/evolution && docker compose up -d web worker'
```
Verify: web returns 200; `\d "Broadcast"` shows `instanceGroupId/groupSendMode/rotateEvery/groupState`; `\d "InstanceGroup"` exists; worker logs "worker started".

> Note (learned prod gotcha): always rebuild `web` **before** running `migrate deploy`, because `migrate deploy` uses the migrations baked into the web image, not the host files. If the column already exists from manual testing, make the migration idempotent or `prisma migrate resolve --applied`.

---

## Self-Review notes (addressed)

- **Spec coverage:** groups m2m (Task 1–4), broadcast group fields + target sender (Task 1, 5), wizard single/group + parallel/rotate + estimate (Task 6), scheduler eligibility/parallel/rotate/group-failover respecting horizon + presets (Task 7), tests (Task 7–8). Single-number mode untouched (group branch `continue`s before the single-mode code). Phase 2 (report/retry) intentionally excluded.
- **Type consistency:** `GroupState = { cursors, activeInstanceId, sentInCycle }` used consistently; `runGroupTick`/`maybeCompleteBroadcast` signatures match call sites; body field names (`instanceGroupId`, `groupSendMode`, `rotateEvery`) match schema, route, and wizard.
- **Ramp:** `remainingBulkToday` returns `null` (unlimited) or a number; eligibility excludes `=== 0`; per-tick `budget` prevents over-assignment; actual per-send counting still happens in `sendViaInstance` (unchanged).
