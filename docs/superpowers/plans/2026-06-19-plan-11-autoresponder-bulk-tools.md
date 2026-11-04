# Plan 11 — Autoresponder, Bulk Scheduling & Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining Wasapbot clone features as independent, skippable slices: a per-account **Autoresponder** (pre-written reply + reject-call + per-customer pause + schedule windows + group exclusions), **Bulk messaging** scheduling upgrades (random send interval + schedule windows + group exclusion), a **Link Generator** (wa.me + QR), a per-account **Profile** page (token/instance/port + profile info + per-instance webhook config), **Export participants** (group participant CSV), and a **My Leads** funnel view.

**Architecture:** Same monorepo conventions as Plans 1–6.5. New tenant-scoped Prisma models (`Autoresponder`) added to `TENANTED_MODELS`; `Broadcast` extended in place. New evolution-client domain APIs (`SettingsApi`, `ProfileApi`) follow the class-per-domain + fetch-mock-test style and are exported from `packages/evolution-client/src/index.ts`. Route handlers follow the `requireMember → tenantClient → zod safeParse → try/catch → {error:e.code}` pattern. The autoresponder runs inside `apps/ingest/src/automate.ts` as a fallback after the keyword chatbot. Bulk + autoresponder share one pure schedule-window helper. Worker logic stays local to `apps/worker/src` (BullMQ). Per-customer pause is tracked in **Redis** (TTL-keyed), not the DB — see Task 1 justification.

**Tech Stack:** TypeScript, Next.js 15 (App Router, server page renders `"use client"` child), next-intl (`apps/web/messages/en-GB.json`), Prisma + Postgres, BullMQ + Redis (`@evo/queue`), Vitest (fetch-mock), Playwright, `qrcode` (new dep for Link Generator), `@evo/evolution-client`, `@evo/send`, `@evo/db`, `@evo/shared`.

**Depends on:** Plan 7 (MediaPicker + `MediaAsset` model + media send variant in `@evo/send`) — **OPTIONAL**: autoresponder/bulk media fields are stored but only sent if the media send path exists; if Plan 7 is not done, treat `mediaAssetId` as a stored-but-unused string and send text-only (do NOT block). Plan 9 (`BotUserLog`) — **OPTIONAL**: My Leads reads `BotUserLog` if present, else degrades to `Conversation`+`Contact`. Both absences are detected at runtime (model-presence check), never assumed.

---

## File Structure

```
packages/db/prisma/schema.prisma                         # +model Autoresponder, +enum AudienceScope, extend model Broadcast
packages/db/src/tenant.ts                                # +"Autoresponder" in TENANTED_MODELS
packages/db/prisma/migrations/<ts>_autoresponder/        # migration (Task 1)
packages/db/prisma/migrations/<ts>_bulk_schedule/        # migration (Task 6)

packages/evolution-client/src/settings.ts                # SettingsApi (Task 2)
packages/evolution-client/src/settings.test.ts
packages/evolution-client/src/profile.ts                 # ProfileApi (Task 9)
packages/evolution-client/src/profile.test.ts
packages/evolution-client/src/index.ts                   # export SettingsApi, ProfileApi

packages/schedule/                                        # NEW pkg @evo/schedule (Task 5)
  package.json
  tsconfig.json
  src/index.ts                                            # isWithinSchedule + types
  src/index.test.ts

apps/web/src/app/api/workspaces/[slug]/autoresponder/route.ts          # GET/PUT (Task 3)
apps/web/src/app/api/workspaces/[slug]/autoresponder/test/route.ts     # send test (Task 3)
apps/web/src/app/[workspaceSlug]/autoresponder/page.tsx                # server (Task 3 UI)
apps/web/src/app/[workspaceSlug]/autoresponder/autoresponder-editor.tsx# "use client" (Task 3 UI)

apps/ingest/src/autoresponder.ts                         # engine (Task 4)
apps/ingest/src/autoresponder.test.ts
apps/ingest/src/automate.ts                              # call autoresponder fallback

apps/web/src/app/api/workspaces/[slug]/broadcasts/route.ts             # extend (Task 7)
apps/worker/src/broadcast-scheduler.ts                                  # extend (Task 7)
apps/worker/src/broadcast-scheduler.test.ts                             # NEW (Task 7)

apps/web/src/app/[workspaceSlug]/link-generator/page.tsx               # (Task 8)
apps/web/src/app/[workspaceSlug]/link-generator/link-generator.tsx
packages/shared/src/wa-link.ts                                          # buildWaLink helper (Task 8)
packages/shared/src/wa-link.test.ts

apps/web/src/app/api/workspaces/[slug]/profile/route.ts                # GET/PUT (Task 9)
apps/web/src/app/api/workspaces/[slug]/profile/webhook/route.ts        # GET/PUT webhook (Task 9)
apps/web/src/app/[workspaceSlug]/profile/page.tsx                      # (Task 9 UI)
apps/web/src/app/[workspaceSlug]/profile/profile-panel.tsx

apps/web/src/app/api/workspaces/[slug]/export-participants/route.ts    # (Task 10)
apps/web/src/app/[workspaceSlug]/export-participants/page.tsx
apps/web/src/app/[workspaceSlug]/export-participants/export-panel.tsx

apps/web/src/app/api/workspaces/[slug]/leads/route.ts                  # (Task 11)
apps/web/src/app/[workspaceSlug]/leads/page.tsx
apps/web/src/app/[workspaceSlug]/leads/leads-table.tsx

apps/web/src/components/shell/sidebar.tsx                # +nav links (Tasks 3,8,9,10,11)
apps/web/messages/en-GB.json                            # +namespaces + nav keys
```

---

### Task 1: Schema — `Autoresponder` model + `AudienceScope` enum + per-customer pause (Redis)

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/src/tenant.ts`, new migration.

**Decision — per-customer pause is tracked in Redis, NOT the DB.** "Pause autoresponder for each customer" means: after replying to a contact, do not reply again to that same contact for N seconds. This is ephemeral, high-churn, per-(instance,contact) state that maps perfectly to a Redis key with a TTL: `autoresp:pause:{instanceId}:{contactPhone}` set with `EX = pausePerCustomerSec`. A DB table would require a sweep/cleanup job and add write load on every inbound message. Redis TTL self-expires. (If Redis is unavailable the engine fails-open and may re-send — acceptable for an autoresponder.) No `AutoresponderState` table is created.

- [ ] Add the enum + model to `packages/db/prisma/schema.prisma` (place near the other automation models, after `model Broadcast`/`BroadcastTarget`):

  ```prisma
  enum AudienceScope {
    all
    individual
    group
  }

  model Autoresponder {
    id                  String        @id @default(cuid())
    workspaceId         String
    instanceId          String        @unique
    enabled             Boolean       @default(false)
    sendTo              AudienceScope @default(all)
    text                String?
    mediaAssetId        String?       // Plan 7 MediaAsset; stored, sent only if media path exists
    caption             String?
    rejectCall          Boolean       @default(false)
    msgCall             String?       // optional auto-reply text on rejected call (Evolution msgCall)
    pausePerCustomerSec Int           @default(60)
    scheduleJson        Json?         // ScheduleConfig from @evo/schedule; null/empty = anytime
    excludeContactListIds String[]    @default([])
    createdAt           DateTime      @default(now())
    updatedAt           DateTime      @updatedAt

    workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
    instance  Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

    @@index([workspaceId])
  }
  ```

- [ ] Add the back-relation to `model Instance` (after `integrations  WorkspaceIntegration[]`):

  ```prisma
    autoresponder Autoresponder?
  ```

- [ ] Add `"Autoresponder"` to `TENANTED_MODELS` in `packages/db/src/tenant.ts`:

  ```ts
    "WorkspaceIntegration",
    "Autoresponder",
  ]);
  ```

- [ ] Generate the migration from the repo root (uses `.env`):

  ```bash
  pnpm --filter @evo/db migrate -- --name autoresponder
  ```

  Expected output includes:

  ```
  Applying migration `<timestamp>_autoresponder`
  The following migration(s) have been created and applied ...
  ✔ Generated Prisma Client
  ```

- [ ] Verify the client typechecks:

  ```bash
  pnpm --filter @evo/db build
  ```

  Expected: exit 0, no TS errors.

- [ ] Commit:

  ```bash
  git add packages/db/prisma/schema.prisma packages/db/src/tenant.ts packages/db/prisma/migrations
  git commit -m "feat(db): Autoresponder model + AudienceScope enum (Plan 11 Task 1)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: `SettingsApi` in `@evo/evolution-client`

**Files:** `packages/evolution-client/src/settings.ts`, `.test.ts`, `index.ts`. Maps to Evolution `POST /settings/set/{instance}` + `GET /settings/find/{instance}` (`evolution-api/src/api/dto/settings.dto.ts`, `routes/settings.router.ts`).

- [ ] Write the failing test first `packages/evolution-client/src/settings.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { EvolutionClient } from "./client";
  import { SettingsApi } from "./settings";

  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  describe("SettingsApi.setSettings", () => {
    it("posts to /settings/set/<name> with the settings payload", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ settings: { rejectCall: true } }), { status: 201 }));
      const api = new SettingsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
      await api.setSettings("inst-1", { rejectCall: true, msgCall: "Sorry, can't take calls.", alwaysOnline: false, readMessages: true });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://evo/settings/set/inst-1");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.rejectCall).toBe(true);
      expect(body.msgCall).toBe("Sorry, can't take calls.");
      expect(body.readMessages).toBe(true);
    });
  });

  describe("SettingsApi.findSettings", () => {
    it("gets /settings/find/<name>", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ rejectCall: false }), { status: 200 }));
      const api = new SettingsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
      const out = await api.findSettings("inst-1");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://evo/settings/find/inst-1");
      expect(init.method).toBe("GET");
      expect(out).toEqual({ rejectCall: false });
    });
  });
  ```

- [ ] Run it red:

  ```bash
  pnpm --filter @evo/evolution-client test -- settings
  ```

  Expected: fails (`Cannot find module './settings'`).

- [ ] Implement `packages/evolution-client/src/settings.ts`:

  ```ts
  import type { EvolutionClient } from "./client";

  export interface InstanceSettings {
    rejectCall?: boolean;
    msgCall?: string;
    groupsIgnore?: boolean;
    alwaysOnline?: boolean;
    readMessages?: boolean;
    readStatus?: boolean;
    syncFullHistory?: boolean;
  }

  export class SettingsApi {
    constructor(private readonly client: EvolutionClient) {}

    async setSettings(instanceName: string, input: InstanceSettings): Promise<unknown> {
      return this.client.request("POST", `/settings/set/${encodeURIComponent(instanceName)}`, input);
    }

    async findSettings(instanceName: string): Promise<InstanceSettings> {
      return this.client.request<InstanceSettings>("GET", `/settings/find/${encodeURIComponent(instanceName)}`);
    }
  }
  ```

- [ ] Export from `packages/evolution-client/src/index.ts`:

  ```ts
  export { SettingsApi, type InstanceSettings } from "./settings";
  ```

- [ ] Run green + build:

  ```bash
  pnpm --filter @evo/evolution-client test -- settings && pnpm --filter @evo/evolution-client build
  ```

  Expected: tests pass, build exit 0.

- [ ] Commit:

  ```bash
  git add packages/evolution-client/src/settings.ts packages/evolution-client/src/settings.test.ts packages/evolution-client/src/index.ts
  git commit -m "feat(evolution-client): SettingsApi for reject-call settings (Plan 11 Task 2)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: `@evo/schedule` — `isWithinSchedule` pure helper (do BEFORE Task 4)

**Files:** new package `packages/schedule`. Shared by autoresponder (Task 4) and bulk (Task 7). Reference the time-window idea from `packages/warmer-engine/src/index.ts` (`hour < startHour || hour >= endHour`) but keep this logic self-contained and fully unit-tested.

**Schema of `scheduleJson` (consistent everywhere):**
```ts
type DayPart = "daytime" | "nighttime" | "odd" | "even";
interface ScheduleConfig {
  parts: DayPart[];      // empty/absent ⇒ anytime
  startHour?: number;    // 0–23 local, inclusive (the "Select time" range start)
  endHour?: number;      // 0–23 local, exclusive
}
```
Semantics: `daytime` = 06:00–18:00, `nighttime` = the complement (18:00–06:00). `odd`/`even` gate on the **calendar day of month** being odd/even. Multiple parts are OR-combined. If `startHour`/`endHour` are set they further AND-restrict the hour. Empty `parts` AND no hour range ⇒ always within.

- [ ] Scaffold the package. `packages/schedule/package.json`:

  ```json
  {
    "name": "@evo/schedule",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
    "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
    "devDependencies": { "typescript": "^5", "vitest": "^2" }
  }
  ```

  `packages/schedule/tsconfig.json` (copy the shape of `packages/warmer-engine/tsconfig.json`):

  ```json
  { "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
  ```

- [ ] Write failing test `packages/schedule/src/index.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { isWithinSchedule } from "./index";

  const at = (iso: string) => new Date(iso);

  describe("isWithinSchedule", () => {
    it("returns true when config is null/empty (anytime)", () => {
      expect(isWithinSchedule(null, at("2026-06-19T03:00:00"))).toBe(true);
      expect(isWithinSchedule({ parts: [] }, at("2026-06-19T03:00:00"))).toBe(true);
    });

    it("daytime: true at 10:00, false at 02:00", () => {
      expect(isWithinSchedule({ parts: ["daytime"] }, at("2026-06-19T10:00:00"))).toBe(true);
      expect(isWithinSchedule({ parts: ["daytime"] }, at("2026-06-19T02:00:00"))).toBe(false);
    });

    it("nighttime: true at 23:00, false at 12:00", () => {
      expect(isWithinSchedule({ parts: ["nighttime"] }, at("2026-06-19T23:00:00"))).toBe(true);
      expect(isWithinSchedule({ parts: ["nighttime"] }, at("2026-06-19T12:00:00"))).toBe(false);
    });

    it("odd day: 19th is odd ⇒ true; 18th ⇒ false", () => {
      expect(isWithinSchedule({ parts: ["odd"] }, at("2026-06-19T12:00:00"))).toBe(true);
      expect(isWithinSchedule({ parts: ["odd"] }, at("2026-06-18T12:00:00"))).toBe(false);
    });

    it("even day: 18th ⇒ true; 19th ⇒ false", () => {
      expect(isWithinSchedule({ parts: ["even"] }, at("2026-06-18T12:00:00"))).toBe(true);
      expect(isWithinSchedule({ parts: ["even"] }, at("2026-06-19T12:00:00"))).toBe(false);
    });

    it("OR-combines parts: daytime OR odd ⇒ true at night on an odd day", () => {
      expect(isWithinSchedule({ parts: ["daytime", "odd"] }, at("2026-06-19T23:00:00"))).toBe(true);
    });

    it("hour range further restricts: parts daytime + 09–12 ⇒ false at 14:00", () => {
      expect(isWithinSchedule({ parts: ["daytime"], startHour: 9, endHour: 12 }, at("2026-06-19T14:00:00"))).toBe(false);
      expect(isWithinSchedule({ parts: ["daytime"], startHour: 9, endHour: 12 }, at("2026-06-19T10:00:00"))).toBe(true);
    });

    it("hour range alone (no parts) restricts: 09–17 ⇒ false at 20:00", () => {
      expect(isWithinSchedule({ parts: [], startHour: 9, endHour: 17 }, at("2026-06-19T20:00:00"))).toBe(false);
    });
  });
  ```

- [ ] Run red:

  ```bash
  pnpm --filter @evo/schedule test
  ```

  Expected: fails (no `src/index.ts`).

- [ ] Implement `packages/schedule/src/index.ts`:

  ```ts
  export type DayPart = "daytime" | "nighttime" | "odd" | "even";

  export interface ScheduleConfig {
    parts?: DayPart[];
    startHour?: number;
    endHour?: number;
  }

  const DAY_START = 6;
  const DAY_END = 18;

  function partMatches(part: DayPart, now: Date): boolean {
    const hour = now.getHours();
    const dom = now.getDate();
    switch (part) {
      case "daytime": return hour >= DAY_START && hour < DAY_END;
      case "nighttime": return hour < DAY_START || hour >= DAY_END;
      case "odd": return dom % 2 === 1;
      case "even": return dom % 2 === 0;
    }
  }

  export function isWithinSchedule(config: ScheduleConfig | null | undefined, now: Date = new Date()): boolean {
    if (!config) return true;
    const parts = config.parts ?? [];
    const hasHourRange = typeof config.startHour === "number" && typeof config.endHour === "number";

    if (parts.length === 0 && !hasHourRange) return true;

    const partsOk = parts.length === 0 ? true : parts.some((p) => partMatches(p, now));
    if (!partsOk) return false;

    if (hasHourRange) {
      const hour = now.getHours();
      if (hour < config.startHour! || hour >= config.endHour!) return false;
    }
    return true;
  }
  ```

- [ ] Run green + build:

  ```bash
  pnpm --filter @evo/schedule test && pnpm --filter @evo/schedule build
  ```

  Expected: all pass, build exit 0.

- [ ] Commit:

  ```bash
  git add packages/schedule
  git commit -m "feat(schedule): @evo/schedule isWithinSchedule helper (Plan 11 Task 5)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> Add `@evo/schedule` to the `dependencies` of `apps/ingest`, `apps/worker`, and `apps/web` `package.json` (`"@evo/schedule": "workspace:*"`) and run `pnpm install` before Tasks 4 and 7.

---

### Task 3: Autoresponder API + UI

**Files:** `apps/web/src/app/api/workspaces/[slug]/autoresponder/route.ts`, `.../autoresponder/test/route.ts`, `apps/web/src/app/[workspaceSlug]/autoresponder/page.tsx`, `.../autoresponder-editor.tsx`, sidebar + i18n.

API: GET returns the autoresponder config for an `instanceId` (null if none). PUT upserts it and, on save, pushes `rejectCall`/`msgCall` to Evolution via `SettingsApi`. Role **Admin** for PUT, **Viewer** for GET. Pattern mirrors the groups route (resolve instance via `tenantClient`, build `EvolutionClient` from `instance.evolutionApiKey` + `EVOLUTION_BASE_URL`).

- [ ] `apps/web/src/app/api/workspaces/[slug]/autoresponder/route.ts`:

  ```ts
  import { NextResponse } from "next/server";
  import { z } from "zod";
  import { tenantClient } from "@evo/db";
  import { EvolutionClient, SettingsApi } from "@evo/evolution-client";
  import { requireMember } from "@/lib/tenancy";
  import { writeAudit } from "@/lib/audit";
  import { AppError, NotFoundError } from "@evo/shared";

  const scheduleSchema = z.object({
    parts: z.array(z.enum(["daytime", "nighttime", "odd", "even"])).default([]),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  }).nullable().optional();

  const putSchema = z.object({
    instanceId: z.string(),
    enabled: z.boolean(),
    sendTo: z.enum(["all", "individual", "group"]),
    text: z.string().max(4000).nullable().optional(),
    mediaAssetId: z.string().nullable().optional(),
    caption: z.string().max(1000).nullable().optional(),
    rejectCall: z.boolean(),
    msgCall: z.string().max(1000).nullable().optional(),
    pausePerCustomerSec: z.number().int().min(0).max(86400),
    scheduleJson: scheduleSchema,
    excludeContactListIds: z.array(z.string()).default([]),
  });

  export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const instanceId = new URL(req.url).searchParams.get("instanceId");
    if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
    try {
      const { workspace } = await requireMember(slug, "Viewer");
      const db = tenantClient(workspace.id);
      const autoresponder = await db.autoresponder.findUnique({ where: { instanceId } });
      return NextResponse.json({ autoresponder });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
      throw e;
    }
  }

  export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    try {
      const { workspace, userId } = await requireMember(slug, "Admin");
      const parsed = putSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
      const d = parsed.data;

      const db = tenantClient(workspace.id);
      const instance = await db.instance.findUnique({ where: { id: d.instanceId } });
      if (!instance) throw new NotFoundError("Instance not found");

      const autoresponder = await db.autoresponder.upsert({
        where: { instanceId: d.instanceId },
        create: {
          instanceId: d.instanceId,
          enabled: d.enabled, sendTo: d.sendTo, text: d.text ?? null,
          mediaAssetId: d.mediaAssetId ?? null, caption: d.caption ?? null,
          rejectCall: d.rejectCall, msgCall: d.msgCall ?? null,
          pausePerCustomerSec: d.pausePerCustomerSec,
          scheduleJson: d.scheduleJson ?? undefined,
          excludeContactListIds: d.excludeContactListIds,
        },
        update: {
          enabled: d.enabled, sendTo: d.sendTo, text: d.text ?? null,
          mediaAssetId: d.mediaAssetId ?? null, caption: d.caption ?? null,
          rejectCall: d.rejectCall, msgCall: d.msgCall ?? null,
          pausePerCustomerSec: d.pausePerCustomerSec,
          scheduleJson: d.scheduleJson ?? undefined,
          excludeContactListIds: d.excludeContactListIds,
        },
      });

      // Push reject-call to Evolution (best-effort; don't fail the save on Evolution error).
      const base = process.env.EVOLUTION_BASE_URL;
      if (base) {
        try {
          const settings = new SettingsApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
          await settings.setSettings(instance.evolutionInstanceName, {
            rejectCall: d.rejectCall,
            ...(d.msgCall ? { msgCall: d.msgCall } : {}),
          });
        } catch { /* surfaced via audit only */ }
      }

      await writeAudit({
        workspaceId: workspace.id, userId, instanceId: d.instanceId,
        action: "autoresponder.saved", target: `instance:${d.instanceId}`,
        diff: { enabled: d.enabled, rejectCall: d.rejectCall, sendTo: d.sendTo },
      });

      return NextResponse.json({ autoresponder });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
      throw e;
    }
  }
  ```

- [ ] `apps/web/src/app/api/workspaces/[slug]/autoresponder/test/route.ts` — Send Test Message:

  ```ts
  import { NextResponse } from "next/server";
  import { z } from "zod";
  import { tenantClient } from "@evo/db";
  import { sendViaInstance } from "@evo/send";
  import { requireMember } from "@/lib/tenancy";
  import { AppError, NotFoundError } from "@evo/shared";

  const schema = z.object({ instanceId: z.string(), to: z.string().min(5), text: z.string().min(1) });

  export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    try {
      const { workspace } = await requireMember(slug, "Admin");
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
      const db = tenantClient(workspace.id);
      const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
      if (!instance) throw new NotFoundError("Instance not found");
      const result = await sendViaInstance(parsed.data.instanceId, { type: "text", to: parsed.data.to, text: parsed.data.text, userId: null });
      return NextResponse.json({ ok: true, messageId: result?.key?.id ?? null });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
      return NextResponse.json({ error: "SEND_FAILED" }, { status: 502 });
    }
  }
  ```

- [ ] Build the UI: server `page.tsx` (resolves instances + contact lists, renders the client editor) and `autoresponder-editor.tsx` (`"use client"`) reproducing the screenshot: instance selector, Status Enable/Disable, Sent to All/Individual/Group, Text & Media (text + media picker placeholder + caption), Send Test, Reject call Enable/Disable, Pause-per-customer dropdown (1/5/10/30/60 min), Schedule (Daytime/Nighttime/Odd/Even chips + start/end time), Exclude contact group multiselect, Submit → `PUT`. Media picker: if Plan 7 `MediaPicker` exists import it; else render a disabled "Media (requires Plan 7)" note. Follow the existing editor style in `apps/web/src/app/[workspaceSlug]/automation` for layout/components.

- [ ] Add nav + i18n. In `apps/web/src/components/shell/sidebar.tsx` add an item `{ href: \`${base}/autoresponder\`, label: labels.autoresponder, icon: Reply }` (import `Reply` from lucide-react) and thread `autoresponder: t("nav.autoresponder")` through the layout `labels` object. Add `"autoresponder": "Autoresponder"` to `nav` and an `autoresponder` namespace in `apps/web/messages/en-GB.json`.

- [ ] Typecheck:

  ```bash
  pnpm --filter @evo/web typecheck
  ```

  Expected: exit 0.

- [ ] Commit:

  ```bash
  git add apps/web/src/app/api/workspaces/\[slug\]/autoresponder apps/web/src/app/\[workspaceSlug\]/autoresponder apps/web/src/components/shell/sidebar.tsx apps/web/src/app/\[workspaceSlug\]/layout.tsx apps/web/messages/en-GB.json
  git commit -m "feat(web): autoresponder config API + editor (Plan 11 Task 3)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Autoresponder engine in ingest

**Files:** `apps/ingest/src/autoresponder.ts`, `.test.ts`, wire into `apps/ingest/src/automate.ts`.

**Precedence rule (DEFINED):** On an inbound message, the keyword chatbot runs first. If a keyword trigger matches → chatbot replies and we **stop** (no autoresponder). If no trigger matches but the chatbot has a Claude/OpenAI fallback configured → the AI fallback runs and we stop. The **autoresponder is the lowest-priority fallback**: it only fires when (a) the chatbot did not handle the message — i.e. no trigger matched AND no AI fallback is configured/it produced nothing — and (b) the autoresponder is enabled for that instance. In code: `automate()` calls the chatbot logic; if and only if nothing was sent, it calls `runAutoresponder()`.

Gating inside `runAutoresponder()` (all must pass to send):
1. `enabled === true`.
2. `sendTo` scope: `individual` ⇒ skip group JIDs (`@g.us`); `group` ⇒ only group JIDs; `all` ⇒ both.
3. `isWithinSchedule(scheduleJson, now)` — skip if outside window.
4. Not paused: Redis key `autoresp:pause:{instanceId}:{contactPhone}` absent (SET it with `EX pausePerCustomerSec` immediately after a successful send; skip if `pausePerCustomerSec === 0`).
5. Contact not in any `excludeContactListIds` list (query `contactListMember` joined to the contact by `phoneE164`).

- [ ] Write failing test `apps/ingest/src/autoresponder.test.ts` (mock `@evo/db`, `@evo/send`, `@evo/queue` redis, `@evo/schedule`). Cover: sends when all gates pass; **does not** send outside schedule window; **does not** send within pause window (Redis key present); **does not** send when contact is in an excluded list; respects `sendTo=individual` skipping a group JID.

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";

  const sendViaInstance = vi.fn().mockResolvedValue({ key: { id: "m1" } });
  const redisGet = vi.fn();
  const redisSet = vi.fn();
  const isWithinSchedule = vi.fn().mockReturnValue(true);
  const prisma = {
    autoresponder: { findUnique: vi.fn() },
    contactListMember: { count: vi.fn().mockResolvedValue(0) },
  };

  vi.mock("@evo/send", () => ({ sendViaInstance }));
  vi.mock("@evo/queue", () => ({ redis: () => ({ get: redisGet, set: redisSet }) }));
  vi.mock("@evo/schedule", () => ({ isWithinSchedule }));
  vi.mock("@evo/db", () => ({ prisma }));

  import { runAutoresponder } from "./autoresponder";

  const base = {
    workspaceId: "w1", instanceId: "i1", contactPhone: "60123456789", inboundText: "hi", isGroup: false,
  };
  const cfg = {
    enabled: true, sendTo: "all", text: "Auto reply", pausePerCustomerSec: 60,
    scheduleJson: null, excludeContactListIds: [] as string[],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isWithinSchedule.mockReturnValue(true);
    redisGet.mockResolvedValue(null);
    prisma.autoresponder.findUnique.mockResolvedValue(cfg);
    prisma.contactListMember.count.mockResolvedValue(0);
  });

  it("sends when all gates pass and arms the pause key", async () => {
    const sent = await runAutoresponder(base);
    expect(sent).toBe(true);
    expect(sendViaInstance).toHaveBeenCalledWith("i1", expect.objectContaining({ to: "60123456789", text: "Auto reply" }));
    expect(redisSet).toHaveBeenCalledWith("autoresp:pause:i1:60123456789", "1", "EX", 60);
  });

  it("does not send outside the schedule window", async () => {
    isWithinSchedule.mockReturnValue(false);
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send while paused", async () => {
    redisGet.mockResolvedValue("1");
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send to an excluded contact list member", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, excludeContactListIds: ["L1"] });
    prisma.contactListMember.count.mockResolvedValue(1);
    expect(await runAutoresponder(base)).toBe(false);
  });

  it("skips group messages when sendTo=individual", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, sendTo: "individual" });
    expect(await runAutoresponder({ ...base, isGroup: true })).toBe(false);
  });
  ```

- [ ] Run red:

  ```bash
  pnpm --filter @evo/ingest test -- autoresponder
  ```

  Expected: fails (no `./autoresponder`).

- [ ] Implement `apps/ingest/src/autoresponder.ts`:

  ```ts
  import { sendViaInstance } from "@evo/send";
  import { redis } from "@evo/queue";
  import { isWithinSchedule, type ScheduleConfig } from "@evo/schedule";

  export interface AutoresponderInput {
    workspaceId: string;
    instanceId: string;
    contactPhone: string;
    inboundText: string;
    isGroup: boolean;
  }

  export async function runAutoresponder(input: AutoresponderInput, now: Date = new Date()): Promise<boolean> {
    const { prisma } = await import("@evo/db");
    const cfg = await prisma.autoresponder.findUnique({ where: { instanceId: input.instanceId } });
    if (!cfg || !cfg.enabled) return false;

    // Scope gate.
    if (cfg.sendTo === "individual" && input.isGroup) return false;
    if (cfg.sendTo === "group" && !input.isGroup) return false;

    // Schedule gate.
    if (!isWithinSchedule((cfg.scheduleJson as ScheduleConfig | null) ?? null, now)) return false;

    // Pause gate.
    const r = redis() as any;
    const pauseKey = `autoresp:pause:${input.instanceId}:${input.contactPhone}`;
    if (cfg.pausePerCustomerSec > 0) {
      const paused = await r.get(pauseKey).catch(() => null);
      if (paused) return false;
    }

    // Exclude-list gate.
    if (cfg.excludeContactListIds.length) {
      const inExcluded = await prisma.contactListMember.count({
        where: {
          listId: { in: cfg.excludeContactListIds },
          contact: { workspaceId: input.workspaceId, phoneE164: input.contactPhone },
        },
      });
      if (inExcluded > 0) return false;
    }

    const text = cfg.text?.trim();
    if (!text) return false; // media-only autoresponder requires Plan 7; text path only here

    await sendViaInstance(input.instanceId, { type: "text", to: input.contactPhone, text, userId: null });

    if (cfg.pausePerCustomerSec > 0) {
      await r.set(pauseKey, "1", "EX", cfg.pausePerCustomerSec).catch(() => undefined);
    }
    return true;
  }
  ```

- [ ] Wire into `apps/ingest/src/automate.ts`. Change `automate()` so it returns whether the chatbot handled the message, then call the autoresponder as a fallback. Replace the early `return;` statements in the chatbot path with a flag and append at the end:

  ```ts
  import { runAutoresponder } from "./autoresponder";
  // ... inside automate(input):
  // Track handled state instead of bare `return;`:
  //   - matched trigger  → handled = true
  //   - AI fallback sent → handled = true
  //   - otherwise        → handled = false
  // At the very end of automate():
  if (!handled) {
    await runAutoresponder({
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      contactPhone: input.contactPhone,
      inboundText: input.inboundText,
      isGroup: input.contactPhone.endsWith("@g.us"),
    });
  }
  ```

  Note: if `automate()` returns early when `!chatbot || !chatbot.enabled`, change that branch to fall through to the autoresponder instead of returning, so the autoresponder works even with no chatbot configured.

- [ ] Run green + the existing automate tests (ensure no regression):

  ```bash
  pnpm --filter @evo/ingest test -- autoresponder automate
  ```

  Expected: all pass.

- [ ] Commit:

  ```bash
  git add apps/ingest/src/autoresponder.ts apps/ingest/src/autoresponder.test.ts apps/ingest/src/automate.ts
  git commit -m "feat(ingest): autoresponder fallback engine after chatbot (Plan 11 Task 4)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Bulk — extend `Broadcast` schema

**Files:** `packages/db/prisma/schema.prisma`, new migration.

- [ ] Add fields to `model Broadcast` (keep the existing `jitterMinMs`/`jitterMaxMs`; the new fields are the user-facing "random interval (seconds)" + schedule + exclusions):

  ```prisma
    intervalMinSec        Int?
    intervalMaxSec        Int?
    scheduleJson          Json?
    excludeContactListIds String[] @default([])
  ```

- [ ] Migrate + build:

  ```bash
  pnpm --filter @evo/db migrate -- --name bulk_schedule && pnpm --filter @evo/db build
  ```

  Expected: migration applied, build exit 0.

- [ ] Commit:

  ```bash
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
  git commit -m "feat(db): Broadcast interval range + schedule + excludes (Plan 11 Task 6)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Bulk — API + worker (random interval + schedule-window defer + exclude)

**Files:** `apps/web/src/app/api/workspaces/[slug]/broadcasts/route.ts` (extend), `apps/worker/src/broadcast-scheduler.ts` (extend), `apps/worker/src/broadcast-scheduler.test.ts` (new).

API: accept `intervalMinSec`, `intervalMaxSec`, `scheduleJson`, `excludeContactListIds`. Subtract excluded-list members from the created `BroadcastTarget` rows (estimated recipients = list members minus contacts that appear in any excluded list). Validate `intervalMinSec <= intervalMaxSec`.

- [ ] Extend `createSchema` and the create logic in `broadcasts/route.ts`:

  ```ts
  const createSchema = z.object({
    name: z.string().min(1).max(120),
    instanceId: z.string(),
    listId: z.string(),
    templateId: z.string().optional(),
    scheduledAt: z.string().datetime().optional(),
    jitterMinMs: z.number().int().min(0).max(60000).optional(),
    jitterMaxMs: z.number().int().min(0).max(120000).optional(),
    intervalMinSec: z.number().int().min(0).max(3600).optional(),
    intervalMaxSec: z.number().int().min(0).max(7200).optional(),
    scheduleJson: z.object({
      parts: z.array(z.enum(["daytime", "nighttime", "odd", "even"])).default([]),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional(),
    }).nullable().optional(),
    excludeContactListIds: z.array(z.string()).default([]),
  });
  ```

  After validating jitter, add:

  ```ts
  if (parsed.data.intervalMinSec !== undefined && parsed.data.intervalMaxSec !== undefined && parsed.data.intervalMinSec > parsed.data.intervalMaxSec) {
    return NextResponse.json({ error: "INTERVAL_INVALID" }, { status: 400 });
  }
  ```

  When building targets, exclude contacts that belong to any excluded list:

  ```ts
  let excludedContactIds = new Set<string>();
  if (parsed.data.excludeContactListIds.length) {
    const ex = await db.contactListMember.findMany({
      where: { listId: { in: parsed.data.excludeContactListIds } },
      select: { contactId: true },
    });
    excludedContactIds = new Set(ex.map((m) => m.contactId));
  }
  const targetMembers = list.members.filter((m) => !excludedContactIds.has(m.contactId));
  ```

  Persist the new fields on `db.broadcast.create({ data: { ... intervalMinSec, intervalMaxSec, scheduleJson, excludeContactListIds } })` and create targets from `targetMembers`. Update the audit `targetCount` to `targetMembers.length`.

- [ ] Extend the worker scheduler. Replace the jitter line + add a schedule-window guard in `apps/worker/src/broadcast-scheduler.ts`. Within the `for (const b of broadcasts)` loop, before enqueuing targets:

  ```ts
  import { isWithinSchedule, type ScheduleConfig } from "@evo/schedule";
  // ...
  // Defer to the next window if outside the broadcast's schedule.
  if (!isWithinSchedule((b.scheduleJson as ScheduleConfig | null) ?? null, now)) continue;
  ```

  And compute the per-send delay using the seconds-based interval range when present, else fall back to the ms jitter:

  ```ts
  const delayMs = computeSendDelayMs(b);
  await sendQueue.add("send", { /* ...existing... */ }, { delay: delayMs, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 });
  ```

  Add the exported pure helper to the same file (so it is unit-testable):

  ```ts
  export function computeSendDelayMs(b: { intervalMinSec: number | null; intervalMaxSec: number | null; jitterMinMs: number; jitterMaxMs: number }, rnd: () => number = Math.random): number {
    if (b.intervalMinSec != null && b.intervalMaxSec != null) {
      const min = b.intervalMinSec * 1000;
      const max = b.intervalMaxSec * 1000;
      return Math.floor(min + rnd() * Math.max(0, max - min));
    }
    return Math.floor(b.jitterMinMs + rnd() * Math.max(0, b.jitterMaxMs - b.jitterMinMs));
  }
  ```

- [ ] Write `apps/worker/src/broadcast-scheduler.test.ts` covering the two pure-ish pieces (no Redis/BullMQ needed):

  ```ts
  import { describe, it, expect } from "vitest";
  import { computeSendDelayMs } from "./broadcast-scheduler";
  import { isWithinSchedule } from "@evo/schedule";

  describe("computeSendDelayMs", () => {
    it("uses the seconds interval range when set (rnd=0 ⇒ min)", () => {
      expect(computeSendDelayMs({ intervalMinSec: 5, intervalMaxSec: 30, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 0)).toBe(5000);
    });
    it("uses the seconds interval range (rnd=1 ⇒ max)", () => {
      expect(computeSendDelayMs({ intervalMinSec: 5, intervalMaxSec: 30, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 1)).toBe(30000);
    });
    it("falls back to ms jitter when interval is null", () => {
      expect(computeSendDelayMs({ intervalMinSec: null, intervalMaxSec: null, jitterMinMs: 2000, jitterMaxMs: 8000 }, () => 0)).toBe(2000);
    });
  });

  describe("schedule defer (window gating)", () => {
    it("defers (false) outside the window and runs (true) inside", () => {
      expect(isWithinSchedule({ parts: ["daytime"] }, new Date("2026-06-19T02:00:00"))).toBe(false);
      expect(isWithinSchedule({ parts: ["daytime"] }, new Date("2026-06-19T10:00:00"))).toBe(true);
    });
  });
  ```

- [ ] Run + typecheck:

  ```bash
  pnpm --filter @evo/worker test -- broadcast-scheduler && pnpm --filter @evo/worker typecheck && pnpm --filter @evo/web typecheck
  ```

  Expected: all pass, exit 0.

- [ ] Update the Bulk messaging UI (`apps/web/src/app/[workspaceSlug]/broadcasts/*`) to add: Exclude Contact Group multiselect, estimated-recipients display (subtracting excludes), Random message interval min/max (seconds) inputs, and Schedule time chips (Daytime/Nighttime/Odd/Even + start/end). Reuse the schedule chip + multiselect components built in Task 3.

- [ ] Commit:

  ```bash
  git add apps/web/src/app/api/workspaces/\[slug\]/broadcasts apps/worker/src/broadcast-scheduler.ts apps/worker/src/broadcast-scheduler.test.ts apps/web/src/app/\[workspaceSlug\]/broadcasts
  git commit -m "feat(bulk): random interval + schedule window + group exclude (Plan 11 Task 7)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: Link Generator (wa.me + QR)

**Files:** `packages/shared/src/wa-link.ts`, `.test.ts`, `apps/web/src/app/[workspaceSlug]/link-generator/page.tsx`, `link-generator.tsx`, sidebar + i18n.

**Decision — persist nothing.** Link Generator is a pure client utility (build a URL + render a QR). There is no backend value in storing generated links; keep it stateless. The page is mostly client-side; the only server data needed is the instances list (to offer "my own number" as the target), already available via the instances API/server page. QR rendering uses the `qrcode` npm package on the client.

- [ ] Add `qrcode` to `apps/web` deps:

  ```bash
  pnpm --filter @evo/web add qrcode && pnpm --filter @evo/web add -D @types/qrcode
  ```

- [ ] Write failing test `packages/shared/src/wa-link.test.ts`:

  ```ts
  import { describe, it, expect } from "vitest";
  import { buildWaLink } from "./wa-link";

  describe("buildWaLink", () => {
    it("strips non-digits and builds wa.me with encoded text", () => {
      expect(buildWaLink("+60 12-345 6789", "Hi there!")).toBe("https://wa.me/60123456789?text=Hi%20there!");
    });
    it("omits ?text when message is empty", () => {
      expect(buildWaLink("60123456789", "")).toBe("https://wa.me/60123456789");
    });
    it("throws on empty number", () => {
      expect(() => buildWaLink("", "hi")).toThrow();
    });
  });
  ```

- [ ] Implement `packages/shared/src/wa-link.ts` and export it from `packages/shared/src/index.ts`:

  ```ts
  export function buildWaLink(phone: string, message = ""): string {
    const digits = phone.replace(/\D/g, "");
    if (!digits) throw new Error("phone required");
    const base = `https://wa.me/${digits}`;
    return message ? `${base}?text=${encodeURIComponent(message)}` : base;
  }
  ```

- [ ] Run green:

  ```bash
  pnpm --filter @evo/shared test -- wa-link && pnpm --filter @evo/shared build
  ```

- [ ] Build the UI per screenshot: instance selector (prefills target with the instance's own `phoneNumber`), phone input, message textarea, "Generate" → show the link (copy button) + a QR canvas rendered with `import QRCode from "qrcode"; QRCode.toCanvas(canvasRef.current, link)`. Add nav item `{ href: \`${base}/link-generator\`, label: labels.linkGenerator, icon: QrCode }` and i18n `nav.linkGenerator` + a `linkGenerator` namespace.

- [ ] Typecheck + commit:

  ```bash
  pnpm --filter @evo/web typecheck
  git add packages/shared/src/wa-link.ts packages/shared/src/wa-link.test.ts packages/shared/src/index.ts apps/web/src/app/\[workspaceSlug\]/link-generator apps/web/src/components/shell/sidebar.tsx apps/web/messages/en-GB.json apps/web/package.json
  git commit -m "feat(web): Link Generator wa.me + QR (Plan 11 Task 8)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: Profile (per-instance) + per-instance webhook config

**Files:** `packages/evolution-client/src/profile.ts`, `.test.ts`, `index.ts`; `apps/web/src/app/api/workspaces/[slug]/profile/route.ts`, `.../profile/webhook/route.ts`; `apps/web/src/app/[workspaceSlug]/profile/page.tsx`, `profile-panel.tsx`; sidebar + i18n.

**Webhook reconciliation (DECIDED):** Plan 6.5 `WebhookSubscription` is a **workspace-level outbound** subscription (our app → customer's URL, HMAC-signed, fan-out of normalised events). The Profile page's "Webhooks" block is a **per-instance Evolution webhook** (Evolution → a URL, configured directly on the Evolution instance via `WebhookApi.set`). These are different layers and we keep both:
- Per-instance webhook here writes via the existing `WebhookApi` (`/webhook/set/{instance}`) and reads via `WebhookApi.find`. It does NOT touch `WebhookSubscription`.
- To avoid breaking inbound ingestion, the Profile webhook editor is **advanced/optional**: it shows the current Evolution webhook (which the app already auto-configures on instance create in Plan 2) and warns that changing the URL away from the app's ingest endpoint will stop the inbox from receiving messages. It is a power-user override, not the primary path. We do not duplicate the `WebhookSubscription` model.

- [ ] Write failing test `packages/evolution-client/src/profile.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { EvolutionClient } from "./client";
  import { ProfileApi } from "./profile";

  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

  describe("ProfileApi", () => {
    it("fetchProfile posts to /chat/fetchProfile/<name>", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: "Eman" }), { status: 200 }));
      const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
      await api.fetchProfile("inst-1", "60123@s.whatsapp.net");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://evo/chat/fetchProfile/inst-1");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body).number).toBe("60123@s.whatsapp.net");
    });
    it("updateProfileName posts to /chat/updateProfileName/<name>", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
      await api.updateProfileName("inst-1", "New Name");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://evo/chat/updateProfileName/inst-1");
      expect(JSON.parse(init.body).name).toBe("New Name");
    });
    it("updateProfileStatus posts to /chat/updateProfileStatus/<name>", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
      await api.updateProfileStatus("inst-1", "Busy");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://evo/chat/updateProfileStatus/inst-1");
      expect(JSON.parse(init.body).status).toBe("Busy");
    });
  });
  ```

- [ ] Implement `packages/evolution-client/src/profile.ts` (base `/chat`, matching `chat.router.ts`) + export from `index.ts`:

  ```ts
  import type { EvolutionClient } from "./client";

  export class ProfileApi {
    constructor(private readonly client: EvolutionClient) {}
    fetchProfile(instanceName: string, number: string) {
      return this.client.request("POST", `/chat/fetchProfile/${encodeURIComponent(instanceName)}`, { number });
    }
    updateProfileName(instanceName: string, name: string) {
      return this.client.request("POST", `/chat/updateProfileName/${encodeURIComponent(instanceName)}`, { name });
    }
    updateProfileStatus(instanceName: string, status: string) {
      return this.client.request("POST", `/chat/updateProfileStatus/${encodeURIComponent(instanceName)}`, { status });
    }
  }
  ```

- [ ] Run green:

  ```bash
  pnpm --filter @evo/evolution-client test -- profile && pnpm --filter @evo/evolution-client build
  ```

- [ ] `profile/route.ts` — GET returns the `Instance` row fields shown in the screenshot (Access Token = `evolutionApiKey`, Instance ID = `evolutionInstanceName`, Port = from env/config or a static placeholder, `phoneNumber`, `profileName`, `profilePictureUrl`); PUT (Admin) updates profile name/status via `ProfileApi`. `profile/webhook/route.ts` — GET via `WebhookApi.find`, PUT (Admin) via `WebhookApi.set` with the warning semantics above. Both follow the groups-route instance-resolution pattern.

- [ ] Build the Profile UI: instance selector, avatar + name + jid header, Logout button (calls the existing instance disconnect/delete path — reuse the instance detail page's logout/delete action; do not re-implement), General Info card (Access Token / Instance ID / Port, read-only, copy buttons), Other Info → Webhooks card (Status Enable/Disable, Webhook URL, Select Webhook Events multiselect, Save). Add nav `{ href: \`${base}/profile\`, label: labels.profile, icon: IdCard }` + i18n.

- [ ] Typecheck + commit:

  ```bash
  pnpm --filter @evo/web typecheck
  git add packages/evolution-client/src/profile.ts packages/evolution-client/src/profile.test.ts packages/evolution-client/src/index.ts apps/web/src/app/api/workspaces/\[slug\]/profile apps/web/src/app/\[workspaceSlug\]/profile apps/web/src/components/shell/sidebar.tsx apps/web/messages/en-GB.json
  git commit -m "feat: per-instance Profile page + ProfileApi + instance webhook (Plan 11 Task 9)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 10: Export participants (group participant CSV)

**Files:** `apps/web/src/app/api/workspaces/[slug]/export-participants/route.ts`, `apps/web/src/app/[workspaceSlug]/export-participants/page.tsx`, `export-panel.tsx`, sidebar + i18n.

Flow: pick instance → choose Export From (Contacts | Group). For Group: list groups via `GroupsApi.fetchAllGroups`, pick one, fetch `participants`, return CSV. For Contacts: export the workspace `Contact` rows (reuse the existing contacts data). Returns `text/csv` with `Content-Disposition: attachment`.

- [ ] `export-participants/route.ts` (GET with `?instanceId=&source=group&groupJid=` or `?source=contacts`):

  ```ts
  import { NextResponse } from "next/server";
  import { tenantClient } from "@evo/db";
  import { EvolutionClient, GroupsApi } from "@evo/evolution-client";
  import { requireMember } from "@/lib/tenancy";
  import { AppError, NotFoundError } from "@evo/shared";

  function toCsv(rows: Array<Record<string, string>>): string {
    if (!rows.length) return "phone,name\n";
    const headers = Object.keys(rows[0]!);
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n") + "\n";
  }

  export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const url = new URL(req.url);
    const source = url.searchParams.get("source") ?? "contacts";
    try {
      const { workspace } = await requireMember(slug, "Viewer");
      const db = tenantClient(workspace.id);

      let rows: Array<Record<string, string>> = [];
      let filename = "contacts.csv";

      if (source === "group") {
        const instanceId = url.searchParams.get("instanceId");
        const groupJid = url.searchParams.get("groupJid");
        if (!instanceId || !groupJid) return NextResponse.json({ error: "instanceId+groupJid required" }, { status: 400 });
        const instance = await db.instance.findUnique({ where: { id: instanceId } });
        if (!instance) throw new NotFoundError("Instance not found");
        const base = process.env.EVOLUTION_BASE_URL;
        if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
        const api = new GroupsApi(new EvolutionClient({ baseUrl: base, apiKey: instance.evolutionApiKey }));
        const parts = await api.participants(instance.evolutionInstanceName, groupJid);
        rows = parts.map((p) => ({ phone: p.id.replace(/@.*/, ""), admin: p.admin ?? "" }));
        filename = "group-participants.csv";
      } else {
        const contacts = await db.contact.findMany({ select: { phoneE164: true, name: true }, take: 100000 });
        rows = contacts.map((c) => ({ phone: c.phoneE164, name: c.name ?? "" }));
      }

      return new NextResponse(toCsv(rows), {
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` },
      });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
      return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 502 });
    }
  }
  ```

- [ ] Build the UI per screenshot: instance selector, Export From radio (Contacts | Group); when Group selected, load groups (reuse the existing groups API at `/api/workspaces/[slug]/groups?instanceId=`) into a select, then a Download button hitting the export route. Add nav `{ href: \`${base}/export-participants\`, label: labels.exportParticipants, icon: Download }` + i18n.

- [ ] Typecheck + commit:

  ```bash
  pnpm --filter @evo/web typecheck
  git add apps/web/src/app/api/workspaces/\[slug\]/export-participants apps/web/src/app/\[workspaceSlug\]/export-participants apps/web/src/components/shell/sidebar.tsx apps/web/messages/en-GB.json
  git commit -m "feat(web): export participants (group CSV) (Plan 11 Task 10)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 11: My Leads (funnel view; degrades without Plan 9)

**Files:** `apps/web/src/app/api/workspaces/[slug]/leads/route.ts`, `apps/web/src/app/[workspaceSlug]/leads/page.tsx`, `leads-table.tsx`, sidebar + i18n.

**Plan 9 dependency:** My Leads is ideally a funnel over `BotUserLog` (contacts captured through bot interactions). Since Plan 9 may not be done, detect the model at runtime and degrade.

- [ ] `leads/route.ts` (GET, Viewer). Detect `BotUserLog` presence via `("botUserLog" in prisma)`; if present, aggregate by contact (count of bot interactions, first/last seen) as the funnel; otherwise degrade to deriving leads from `Conversation` (one row per contact, with `lastMessageAt`, `unreadCount`, message count) joined to `Contact` for the name:

  ```ts
  import { NextResponse } from "next/server";
  import { tenantClient, prisma } from "@evo/db";
  import { requireMember } from "@/lib/tenancy";
  import { AppError } from "@evo/shared";

  export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    try {
      const { workspace } = await requireMember(slug, "Viewer");
      const db = tenantClient(workspace.id);

      if ("botUserLog" in (prisma as any)) {
        // Funnel version (Plan 9 present).
        const leads = await (db as any).botUserLog.groupBy({
          by: ["contactPhone"],
          _count: { _all: true },
          _max: { createdAt: true },
          _min: { createdAt: true },
          orderBy: { _max: { createdAt: "desc" } },
          take: 500,
        });
        return NextResponse.json({ leads, mode: "funnel" });
      }

      // Degraded version: conversations as leads.
      const convos = await db.conversation.findMany({
        orderBy: { lastMessageAt: "desc" },
        take: 500,
        select: { contactPhone: true, contactName: true, lastMessageAt: true, unreadCount: true, status: true },
      });
      return NextResponse.json({ leads: convos, mode: "degraded" });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
      throw e;
    }
  }
  ```

- [ ] Build the My Leads UI: a table of leads (phone, name, last activity, interaction count or status) with a banner when `mode === "degraded"` noting funnel analytics require Plan 9. Add nav `{ href: \`${base}/leads\`, label: labels.leads, icon: UsersRound }` + i18n.

- [ ] Typecheck + commit:

  ```bash
  pnpm --filter @evo/web typecheck
  git add apps/web/src/app/api/workspaces/\[slug\]/leads apps/web/src/app/\[workspaceSlug\]/leads apps/web/src/components/shell/sidebar.tsx apps/web/messages/en-GB.json
  git commit -m "feat(web): My Leads funnel view (degrades without Plan 9) (Plan 11 Task 11)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 12: Final review

- [ ] Run the full quality gate:

  ```bash
  pnpm --filter @evo/schedule test
  pnpm --filter @evo/evolution-client test
  pnpm --filter @evo/ingest test
  pnpm --filter @evo/worker test
  pnpm --filter @evo/shared test
  pnpm --filter @evo/web typecheck
  pnpm --filter @evo/db build
  ```

  Expected: every command exits 0.

- [ ] Manual smoke (docker compose up): save an autoresponder with Reject call ON, confirm Evolution `GET /settings/find/{instance}` reflects `rejectCall:true`; send an inbound message from a non-excluded number outside the chatbot keywords and confirm the auto-reply arrives once, then NOT again within the pause window; create a bulk campaign with a 5–30s interval + Daytime schedule and confirm sends only enqueue during daytime with randomised delays; generate a wa.me link + QR; open the Profile page and verify token/instance/port render; export a group's participants to CSV; open My Leads.

- [ ] Self-review against the checklist below, then run the superpowers:requesting-code-review skill.

---

## Self-review checklist

- [ ] `Autoresponder` is in `TENANTED_MODELS`; all `db.autoresponder.*` calls go through `tenantClient`, never raw `prisma`, inside route handlers.
- [ ] Per-customer pause uses the Redis key `autoresp:pause:{instanceId}:{contactPhone}` with `EX = pausePerCustomerSec`; no `AutoresponderState` table exists; engine fails-open on Redis errors.
- [ ] `scheduleJson` shape (`{ parts, startHour?, endHour? }`) and `DayPart` values are identical across `@evo/schedule`, the autoresponder zod schema, and the broadcast zod schema.
- [ ] `isWithinSchedule(null|empty)` returns `true` (anytime); odd/even gate on calendar day-of-month; daytime=06–18; nighttime=complement; hour range AND-restricts; OR across parts. All branches unit-tested.
- [ ] Autoresponder-vs-chatbot precedence: chatbot trigger → chatbot AI fallback → autoresponder (only if nothing was sent AND enabled). `automate()` falls through to the autoresponder even when no chatbot is configured.
- [ ] Autoresponder gates: enabled, sendTo scope, schedule, pause, exclude-list — all enforced and tested.
- [ ] Bulk: `intervalMinSec <= intervalMaxSec` validated (400 `INTERVAL_INVALID`); `computeSendDelayMs` prefers the seconds range, falls back to ms jitter; scheduler defers (skips this tick) when outside the window; excluded-list contacts are removed from targets and from the estimated count.
- [ ] `SettingsApi`/`ProfileApi` follow the class-per-domain + fetch-mock-test style and are exported from `index.ts`; routes resolve the instance via `tenantClient` and build `EvolutionClient` from `instance.evolutionApiKey` + `EVOLUTION_BASE_URL`.
- [ ] Profile webhook (per-instance, `WebhookApi`) is kept distinct from Plan 6.5 `WebhookSubscription` (workspace outbound); no model duplicated; URL-change warning present; instance webhook editor is an advanced override.
- [ ] Media fields (`mediaAssetId`/`caption`) are stored but only sent when the Plan 7 media path exists; text-only autoresponder/bulk works without Plan 7.
- [ ] My Leads detects `BotUserLog` at runtime and degrades to `Conversation`-derived leads with a banner when Plan 9 is absent.
- [ ] Every new route handler uses `requireMember(slug, role)` (Viewer for reads, Admin for mutations), zod `safeParse` → 400 `VALIDATION`, try/catch → `{error:e.code}` on `AppError`.
- [ ] All new nav items + every user-facing string are in `apps/web/messages/en-GB.json` (next-intl); each page is a server component rendering a `"use client"` child.
- [ ] `qrcode` (+ `@types/qrcode`) added to `apps/web`; `@evo/schedule` added to ingest/worker/web deps; `pnpm install` run; Link Generator persists nothing.
- [ ] Migrations generated for Task 1 and Task 6 with descriptive names; `pnpm --filter @evo/db build` clean.
- [ ] Each task ends with a passing test/typecheck and a conventional commit; tasks are independently skippable.
