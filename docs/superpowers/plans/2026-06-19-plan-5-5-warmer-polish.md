# Plan 5.5 — Warmer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON-blob warmer config with a structured editor, enforce internal-chat mode (warmer instances only message other warmer instances in the same workspace), enforce a daily ramp curve (gradually increase message volume), and track conversation turns so the engine never sends back-to-back messages from the same instance.

**Architecture:** Extend the existing `WarmerProfile` model with first-class typed columns (no schema for the new fields was created during Plan 5 — they sat in a generic `config` JSON). Add `WarmerInternalPeer` join model so two warmer profiles can be paired bidirectionally with an explicit handshake. The runner (`packages/warmer-engine`) gains: a daily budget check, a turn check (skip if last sender was self), and a peer selector that only returns other profiles paired in the same workspace. Replace the existing UI's textarea-of-JSON with a typed form.

**Tech Stack:** Prisma, BullMQ, existing `@evo/warmer-engine`, React form (no extra UI deps).

---

## File Structure

**Schema:** `packages/db/prisma/schema.prisma` — extend `WarmerProfile`, add `WarmerInternalPeer`, add columns to `WarmerEvent` for turn tracking.

**Engine:**
- `packages/warmer-engine/src/types.ts` — add typed config interface.
- `packages/warmer-engine/src/selector.ts` — new file: peer selection logic + ramp-budget check.
- `packages/warmer-engine/src/runner.ts` — extend to call selector, enforce turn alternation.
- `packages/warmer-engine/src/selector.test.ts` — unit tests.

**Worker:**
- `apps/worker/src/index.ts` — warmer-send processor: refuse send when budget exceeded or peer turn rule violated.

**API:**
- `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/route.ts` — PUT validates the new typed shape.
- `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/peers/route.ts` — list / link.
- `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/peers/[peerId]/route.ts` — unlink.

**UI:**
- `apps/web/src/app/[workspaceSlug]/warmer/[id]/page.tsx` — replace JSON textarea with `<ProfileForm>` + `<PeersPanel>`.
- `apps/web/src/app/[workspaceSlug]/warmer/[id]/profile-form.tsx`
- `apps/web/src/app/[workspaceSlug]/warmer/[id]/peers-panel.tsx`

---

## Task 1: Schema changes

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/tenant.ts`
- Migration generated.

- [ ] **Step 1: Extend WarmerProfile**

In `schema.prisma`, replace the existing `WarmerProfile` model's `config Json` field (if present) with these typed fields. Keep the existing `id`, `workspaceId`, `instanceId`, `presetId`, `enabled`, timestamps.

```prisma
model WarmerProfile {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  instanceId      String
  instance        Instance @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  presetId        String?
  preset          WarmerPreset? @relation(fields: [presetId], references: [id])
  enabled         Boolean  @default(true)
  internalOnly    Boolean  @default(true)
  dailyTargetStart Int     @default(10)
  dailyTargetEnd   Int     @default(80)
  rampDays        Int      @default(14)
  rampStartDate   DateTime @default(now())
  minIntervalSec  Int      @default(120)
  maxIntervalSec  Int      @default(900)
  quietStartHour  Int      @default(22)
  quietEndHour    Int      @default(7)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  peersA          WarmerInternalPeer[] @relation("peerA")
  peersB          WarmerInternalPeer[] @relation("peerB")
  runs            WarmerRun[]
  events          WarmerEvent[]
  @@unique([workspaceId, instanceId])
}

model WarmerInternalPeer {
  id            String   @id @default(cuid())
  workspaceId   String
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  profileAId    String
  profileA      WarmerProfile @relation("peerA", fields: [profileAId], references: [id], onDelete: Cascade)
  profileBId    String
  profileB      WarmerProfile @relation("peerB", fields: [profileBId], references: [id], onDelete: Cascade)
  createdAt     DateTime @default(now())
  @@unique([workspaceId, profileAId, profileBId])
}
```

Modify `WarmerEvent` (add columns for turn tracking):

```prisma
model WarmerEvent {
  // ... existing fields
  peerProfileId String?   // which warmer profile was the counterpart
  isInbound     Boolean   @default(false)  // received by this profile
  @@index([profileId, createdAt])
}
```

- [ ] **Step 2: tenancy**

`packages/db/src/tenant.ts`: add `"WarmerInternalPeer"` to `TENANTED_MODELS`.

- [ ] **Step 3: Migration**

```bash
pnpm --filter @evo/db prisma:migrate --name warmer_polish
```

The migration must handle existing rows — set `internalOnly=true` and defaults. If the prior schema had a `config Json` column, drop it AFTER copying any defaults you care to preserve (engineer judgment; default values are fine).

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "feat(db): typed warmer profile config + internal peers + turn tracking"
```

---

## Task 2: Selector + budget engine (TDD)

**Files:**
- Create: `packages/warmer-engine/src/selector.ts`
- Create: `packages/warmer-engine/src/selector.test.ts`

- [ ] **Step 1: Types**

In `packages/warmer-engine/src/types.ts` (extend existing), add:

```typescript
export interface ProfileConfig {
  internalOnly: boolean;
  dailyTargetStart: number;
  dailyTargetEnd: number;
  rampDays: number;
  rampStartDate: Date;
  minIntervalSec: number;
  maxIntervalSec: number;
  quietStartHour: number;
  quietEndHour: number;
}

export interface EventRow {
  createdAt: Date;
  isInbound: boolean;
  peerProfileId: string | null;
}

export interface SelectorContext {
  now: Date;
  profile: ProfileConfig;
  todaysOutboundCount: number;
  recentEvents: EventRow[]; // ordered newest-first, limit ~50
  internalPeers: Array<{ profileId: string; instanceJid: string }>;
}
```

- [ ] **Step 2: Failing tests — `selector.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { dailyBudget, isInQuietHours, canSendNext, pickPeer } from "./selector";

const baseProfile = {
  internalOnly: true,
  dailyTargetStart: 10,
  dailyTargetEnd: 80,
  rampDays: 14,
  rampStartDate: new Date("2026-06-01T00:00:00Z"),
  minIntervalSec: 120,
  maxIntervalSec: 900,
  quietStartHour: 22,
  quietEndHour: 7,
};

describe("dailyBudget", () => {
  it("returns start target on day 0", () => {
    expect(dailyBudget(baseProfile, new Date("2026-06-01T12:00:00Z"))).toBe(10);
  });
  it("returns end target on or after ramp completion", () => {
    expect(dailyBudget(baseProfile, new Date("2026-06-30T12:00:00Z"))).toBe(80);
  });
  it("linearly interpolates mid-ramp", () => {
    const half = dailyBudget(baseProfile, new Date("2026-06-08T12:00:00Z"));
    expect(half).toBeGreaterThanOrEqual(40);
    expect(half).toBeLessThanOrEqual(50);
  });
});

describe("isInQuietHours", () => {
  it("respects an overnight quiet window", () => {
    expect(isInQuietHours(baseProfile, new Date("2026-06-01T23:00:00Z"))).toBe(true);
    expect(isInQuietHours(baseProfile, new Date("2026-06-01T05:00:00Z"))).toBe(true);
    expect(isInQuietHours(baseProfile, new Date("2026-06-01T12:00:00Z"))).toBe(false);
  });
});

describe("canSendNext", () => {
  it("blocks when budget already met", () => {
    const r = canSendNext({
      now: new Date("2026-06-01T12:00:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 10,
      recentEvents: [],
      internalPeers: [{ profileId: "p2", instanceJid: "j" }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("budget");
  });

  it("blocks when last event was an outbound from us (must alternate)", () => {
    const r = canSendNext({
      now: new Date("2026-06-01T12:00:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 1,
      recentEvents: [{ createdAt: new Date("2026-06-01T11:59:00Z"), isInbound: false, peerProfileId: "p2" }],
      internalPeers: [{ profileId: "p2", instanceJid: "j" }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("turn");
  });

  it("blocks during quiet hours", () => {
    const r = canSendNext({
      now: new Date("2026-06-01T23:30:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 1,
      recentEvents: [],
      internalPeers: [{ profileId: "p2", instanceJid: "j" }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("quiet");
  });

  it("allows when budget, turn, and quiet all clear", () => {
    const r = canSendNext({
      now: new Date("2026-06-01T12:00:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 1,
      recentEvents: [{ createdAt: new Date("2026-06-01T11:00:00Z"), isInbound: true, peerProfileId: "p2" }],
      internalPeers: [{ profileId: "p2", instanceJid: "j" }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("pickPeer", () => {
  it("rotates by oldest interaction", () => {
    const peer = pickPeer({
      now: new Date("2026-06-01T12:00:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 0,
      recentEvents: [
        { createdAt: new Date("2026-06-01T11:00:00Z"), isInbound: false, peerProfileId: "p2" },
      ],
      internalPeers: [
        { profileId: "p2", instanceJid: "p2-jid" },
        { profileId: "p3", instanceJid: "p3-jid" },
      ],
    });
    expect(peer?.profileId).toBe("p3"); // p2 just got something; rotate
  });

  it("returns null when internalOnly and no peers", () => {
    const peer = pickPeer({
      now: new Date("2026-06-01T12:00:00Z"),
      profile: baseProfile,
      todaysOutboundCount: 0,
      recentEvents: [],
      internalPeers: [],
    });
    expect(peer).toBeNull();
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
pnpm --filter @evo/warmer-engine test
```

Expected: FAIL.

- [ ] **Step 4: Implement — `selector.ts`**

```typescript
import type { ProfileConfig, SelectorContext } from "./types";

export function dailyBudget(profile: ProfileConfig, now: Date): number {
  const elapsedDays = Math.floor((now.getTime() - profile.rampStartDate.getTime()) / 86_400_000);
  if (elapsedDays >= profile.rampDays) return profile.dailyTargetEnd;
  if (elapsedDays <= 0) return profile.dailyTargetStart;
  const t = elapsedDays / profile.rampDays;
  return Math.round(profile.dailyTargetStart + (profile.dailyTargetEnd - profile.dailyTargetStart) * t);
}

export function isInQuietHours(profile: ProfileConfig, now: Date): boolean {
  const h = now.getUTCHours();
  const start = profile.quietStartHour;
  const end = profile.quietEndHour;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  // overnight window
  return h >= start || h < end;
}

export type SendDecision = { ok: true } | { ok: false; reason: "budget" | "turn" | "quiet" | "no_peer" };

export function canSendNext(ctx: SelectorContext): SendDecision {
  if (isInQuietHours(ctx.profile, ctx.now)) return { ok: false, reason: "quiet" };
  if (ctx.todaysOutboundCount >= dailyBudget(ctx.profile, ctx.now)) return { ok: false, reason: "budget" };
  const last = ctx.recentEvents[0];
  if (last && !last.isInbound) return { ok: false, reason: "turn" };
  if (ctx.profile.internalOnly && ctx.internalPeers.length === 0) return { ok: false, reason: "no_peer" };
  return { ok: true };
}

export function pickPeer(ctx: SelectorContext): { profileId: string; instanceJid: string } | null {
  if (ctx.internalPeers.length === 0) return null;
  // Pick peer with the oldest last interaction (or never).
  const scored = ctx.internalPeers.map((p) => {
    const last = ctx.recentEvents.find((e) => e.peerProfileId === p.profileId);
    return { peer: p, lastTs: last?.createdAt.getTime() ?? 0 };
  });
  scored.sort((a, b) => a.lastTs - b.lastTs);
  return scored[0]?.peer ?? null;
}
```

- [ ] **Step 5: Run, verify PASS**

```bash
pnpm --filter @evo/warmer-engine test
```

Expected: all selector + existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/warmer-engine
git commit -m "feat(warmer-engine): ramp budget, quiet hours, turn alternation, peer selection"
```

---

## Task 3: Wire selector into worker

**Files:**
- Modify: `apps/worker/src/index.ts` (warmer-tick / warmer-send processors)

- [ ] **Step 1: Read current worker warmer logic**

Find the existing `warmer-tick` processor in `apps/worker/src/index.ts`.

- [ ] **Step 2: Modify tick to use the new selector**

For each enabled `WarmerProfile`:

```typescript
const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0);
const todaysOutboundCount = await prisma.warmerEvent.count({
  where: { profileId: profile.id, isInbound: false, createdAt: { gte: todayStart } },
});
const recentEvents = await prisma.warmerEvent.findMany({
  where: { profileId: profile.id },
  orderBy: { createdAt: "desc" },
  take: 50,
  select: { createdAt: true, isInbound: true, peerProfileId: true },
});
const peerLinks = await prisma.warmerInternalPeer.findMany({
  where: { workspaceId: profile.workspaceId, OR: [{ profileAId: profile.id }, { profileBId: profile.id }] },
  include: {
    profileA: { include: { instance: true } },
    profileB: { include: { instance: true } },
  },
});
const internalPeers = peerLinks.map((p) => {
  const other = p.profileAId === profile.id ? p.profileB : p.profileA;
  return { profileId: other.id, instanceJid: other.instance.phoneJid ?? "" };
}).filter((p) => p.instanceJid);

const decision = canSendNext({ now: new Date(), profile, todaysOutboundCount, recentEvents, internalPeers });
if (!decision.ok) continue;

const peer = pickPeer({ now: new Date(), profile, todaysOutboundCount, recentEvents, internalPeers });
if (!peer) continue;

await warmerSendQueue.add("send", { profileId: profile.id, peerProfileId: peer.profileId, peerJid: peer.instanceJid });
```

The send processor records a `WarmerEvent` row with `isInbound=false`, `peerProfileId=peer.profileId` after calling `sendViaInstance`.

The webhook ingest already creates `WarmerEvent` rows for inbound; modify that path (`apps/ingest/src/persist.ts` or equivalent) to set `peerProfileId` by looking up which warmer profile owns the sender's JID (in the same workspace).

- [ ] **Step 3: typecheck + commit**

```bash
pnpm --filter @evo/worker typecheck
pnpm --filter @evo/ingest typecheck
git add apps/worker apps/ingest
git commit -m "feat(worker,ingest): warmer enforces ramp budget, quiet hours, turn alternation, internal peers"
```

---

## Task 4: Peers API

**Files:**
- Create: `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/peers/route.ts`
- Create: `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/peers/[peerId]/route.ts`

- [ ] **Step 1: List + create**

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const createSchema = z.object({ peerProfileId: z.string() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const profile = await db.warmerProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundError("profile not found");
    const peers = await db.warmerInternalPeer.findMany({
      where: { OR: [{ profileAId: id }, { profileBId: id }] },
      include: { profileA: { select: { id: true, instance: { select: { label: true } } } }, profileB: { select: { id: true, instance: { select: { label: true } } } } },
    });
    return NextResponse.json({ peers: peers.map((p) => p.profileAId === id ? p.profileB : p.profileA) });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    if (parsed.data.peerProfileId === id) return NextResponse.json({ error: "SELF_PEER" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const [a, b] = [id, parsed.data.peerProfileId].sort();
    await db.warmerInternalPeer.upsert({
      where: { workspaceId_profileAId_profileBId: { workspaceId: workspace.id, profileAId: a, profileBId: b } } as any,
      create: { profileAId: a, profileBId: b } as any,
      update: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 2: Unlink**

```typescript
// [peerId]/route.ts
import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string; peerId: string }> }) {
  const { slug, id, peerId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const [a, b] = [id, peerId].sort();
    await db.warmerInternalPeer.deleteMany({ where: { profileAId: a, profileBId: b } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
```

- [ ] **Step 3: Update profile PUT to accept typed fields**

In `apps/web/src/app/api/workspaces/[slug]/warmer/profiles/[id]/route.ts` (PUT), replace any free-form `config` field with the new typed Zod schema:

```typescript
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  internalOnly: z.boolean().optional(),
  dailyTargetStart: z.number().int().min(1).max(500).optional(),
  dailyTargetEnd: z.number().int().min(1).max(500).optional(),
  rampDays: z.number().int().min(1).max(90).optional(),
  rampStartDate: z.string().datetime().optional(),
  minIntervalSec: z.number().int().min(30).max(86400).optional(),
  maxIntervalSec: z.number().int().min(30).max(86400).optional(),
  quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(),
});
```

- [ ] **Step 4: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/api/workspaces/[slug]/warmer"
git commit -m "feat(web): warmer profile typed config + internal peer link/unlink"
```

---

## Task 5: UI — structured editor

**Files:**
- Modify: `apps/web/src/app/[workspaceSlug]/warmer/[id]/page.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/warmer/[id]/profile-form.tsx`
- Create: `apps/web/src/app/[workspaceSlug]/warmer/[id]/peers-panel.tsx`

- [ ] **Step 1: Read current page**

Read `apps/web/src/app/[workspaceSlug]/warmer/[id]/page.tsx`. Identify the JSON textarea and replace with the new components.

- [ ] **Step 2: Server page renders both panels**

```tsx
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import ProfileForm from "./profile-form";
import PeersPanel from "./peers-panel";

export default async function WarmerProfilePage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const profile = await db.warmerProfile.findUnique({ where: { id }, include: { instance: { select: { label: true } } } });
  if (!profile) return <div className="p-8">Not found</div>;
  const others = await db.warmerProfile.findMany({
    where: { id: { not: id } },
    include: { instance: { select: { label: true } } },
  });
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{profile.instance.label}</h1>
      <ProfileForm workspaceSlug={workspaceSlug} id={id} initial={{
        enabled: profile.enabled,
        internalOnly: profile.internalOnly,
        dailyTargetStart: profile.dailyTargetStart,
        dailyTargetEnd: profile.dailyTargetEnd,
        rampDays: profile.rampDays,
        rampStartDate: profile.rampStartDate.toISOString().slice(0, 10),
        minIntervalSec: profile.minIntervalSec,
        maxIntervalSec: profile.maxIntervalSec,
        quietStartHour: profile.quietStartHour,
        quietEndHour: profile.quietEndHour,
      }} />
      <PeersPanel
        workspaceSlug={workspaceSlug}
        profileId={id}
        otherProfiles={others.map((o) => ({ id: o.id, label: o.instance.label }))}
      />
    </div>
  );
}
```

- [ ] **Step 3: ProfileForm**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Initial = {
  enabled: boolean; internalOnly: boolean;
  dailyTargetStart: number; dailyTargetEnd: number; rampDays: number; rampStartDate: string;
  minIntervalSec: number; maxIntervalSec: number;
  quietStartHour: number; quietEndHour: number;
};

export default function ProfileForm({ workspaceSlug, id, initial }: { workspaceSlug: string; id: string; initial: Initial }) {
  const [s, setS] = useState(initial);
  const router = useRouter();
  function set<K extends keyof Initial>(k: K, v: Initial[K]) { setS({ ...s, [k]: v }); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/workspaces/${workspaceSlug}/warmer/profiles/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...s, rampStartDate: new Date(s.rampStartDate).toISOString() }),
    });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="border rounded p-4 space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.internalOnly} onChange={(e) => set("internalOnly", e.target.checked)} /> Internal-only (warms with other workspace warmers)</label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-sm">Daily target start</span><input type="number" className="w-full border rounded p-2" value={s.dailyTargetStart} onChange={(e) => set("dailyTargetStart", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Daily target end</span><input type="number" className="w-full border rounded p-2" value={s.dailyTargetEnd} onChange={(e) => set("dailyTargetEnd", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Ramp days</span><input type="number" className="w-full border rounded p-2" value={s.rampDays} onChange={(e) => set("rampDays", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Ramp start date</span><input type="date" className="w-full border rounded p-2" value={s.rampStartDate} onChange={(e) => set("rampStartDate", e.target.value)} /></label>
        <label className="block"><span className="text-sm">Min interval (s)</span><input type="number" className="w-full border rounded p-2" value={s.minIntervalSec} onChange={(e) => set("minIntervalSec", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Max interval (s)</span><input type="number" className="w-full border rounded p-2" value={s.maxIntervalSec} onChange={(e) => set("maxIntervalSec", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Quiet start hour (UTC)</span><input type="number" min={0} max={23} className="w-full border rounded p-2" value={s.quietStartHour} onChange={(e) => set("quietStartHour", Number(e.target.value))} /></label>
        <label className="block"><span className="text-sm">Quiet end hour (UTC)</span><input type="number" min={0} max={23} className="w-full border rounded p-2" value={s.quietEndHour} onChange={(e) => set("quietEndHour", Number(e.target.value))} /></label>
      </div>
      <button className="bg-black text-white rounded p-2 px-4">Save</button>
    </form>
  );
}
```

- [ ] **Step 4: PeersPanel**

```tsx
"use client";
import { useEffect, useState } from "react";

type Other = { id: string; label: string };

export default function PeersPanel({ workspaceSlug, profileId, otherProfiles }: { workspaceSlug: string; profileId: string; otherProfiles: Other[] }) {
  const [peers, setPeers] = useState<Other[]>([]);

  async function load() {
    const res = await fetch(`/api/workspaces/${workspaceSlug}/warmer/profiles/${profileId}/peers`);
    if (res.ok) setPeers((await res.json()).peers);
  }
  useEffect(() => { load(); }, []);

  async function link(peerId: string) {
    await fetch(`/api/workspaces/${workspaceSlug}/warmer/profiles/${profileId}/peers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ peerProfileId: peerId }),
    });
    load();
  }

  async function unlink(peerId: string) {
    await fetch(`/api/workspaces/${workspaceSlug}/warmer/profiles/${profileId}/peers/${peerId}`, { method: "DELETE" });
    load();
  }

  const unlinked = otherProfiles.filter((p) => !peers.some((q) => q.id === p.id));

  return (
    <div className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">Internal peers</h2>
      <p className="text-xs text-gray-600">Internal-only mode requires at least one peer. Add other warmer profiles in this workspace to chat with.</p>
      <ul className="text-sm space-y-1">
        {peers.map((p) => (
          <li key={p.id} className="flex justify-between items-center border-b pb-1">
            <span>{p.label}</span>
            <button onClick={() => unlink(p.id)} className="text-xs underline text-red-600">Unlink</button>
          </li>
        ))}
        {peers.length === 0 && <li className="text-xs text-gray-500">No peers linked.</li>}
      </ul>
      {unlinked.length > 0 && (
        <div className="pt-2 border-t">
          <span className="text-xs text-gray-600">Add a peer:</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {unlinked.map((p) => <button key={p.id} onClick={() => link(p.id)} className="border rounded p-1 px-2 text-xs">+ {p.label}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: typecheck + commit**

```bash
pnpm --filter @evo/web typecheck
git add "apps/web/src/app/[workspaceSlug]/warmer"
git commit -m "feat(web): structured warmer profile editor + internal peers panel"
```

---

## Task 6: e2e — internal pair chats

**Files:**
- Create: `apps/web/tests/e2e/warmer-internal.spec.ts`

- [ ] **Step 1: Spec**

Create two warmer profiles in the same workspace. Link them as peers. Stub Evolution send. Advance the worker's warmer-tick manually (or use the BullMQ test harness already used in earlier e2e specs). Assert: profile A sends to profile B's JID; record an inbound `WarmerEvent` for profile A's next tick; assert B sends back; assert turn alternation holds.

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @evo/web e2e -- warmer-internal.spec.ts
git add apps/web/tests/e2e/warmer-internal.spec.ts
git commit -m "test(web): e2e for warmer internal peer turn alternation"
```

---

## Task 7: Final review

Verify:
- `WarmerInternalPeer` in `TENANTED_MODELS`.
- Migration deleted the old `config Json` column cleanly (or migrated values into typed columns).
- All selector tests pass.
- Worker tick code reads the typed columns, not the dropped `config` JSON.
- Webhook ingest sets `peerProfileId` on inbound events (so turn tracking works).
- UI: no JSON textarea left.
