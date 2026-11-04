# Media in Automation (Plan 7 completion) — Design

Date: 2026-07-03
Status: Approved (direction delegated)

## Why

Plan 7 shipped the file manager and `sendViaInstance` media support, but every
automation surface still ignores its stored `mediaAssetId`: keyword-trigger
responses, bot action chains (`send_text`), the autoresponder (media-only replies
explicitly deferred), follow-up steps, and inbound integrations. Competitor panels
send images/documents from bots as table stakes; ours silently drops them.

## Goals

1. A single shared resolver that turns a `MediaAsset` id into a `SendMediaPayload`
   (public raw URL that Evolution fetches server-to-server).
2. Wire it into all five automation surfaces, with graceful text fallback when the
   asset is missing or deleted.
3. No schema changes — every surface already stores `mediaAssetId` (+ caption where
   relevant). Broadcast templates stay text-only (separate future work: template
   media needs schema + editor UI).

## Approach

- Move `mediaPublicBaseUrl()` / `assetPublicUrl()` from `apps/web/src/lib/media-storage.ts`
  into `@evo/shared` (pure, env-driven); web re-exports to keep existing imports working.
- Add `mediaPayloadFromAsset(assetId, workspaceId, to, caption)` to `@evo/send`
  (it already depends on `@evo/db`): loads the asset scoped to the workspace
  (cross-tenant safety), loads the workspace slug, returns a `SendMediaPayload`
  (`mediatype` = `asset.kind`, `fileName` = original filename) or `null` if not found.
- Call sites (all fall back to the existing text path when resolution returns null):
  1. `apps/ingest/src/automate.ts` — legacy trigger response: media with
     `caption = matched.response`.
  2. `apps/ingest/src/actions.ts` — `send_text` action: media with
     `caption = rendered text`.
  3. `apps/ingest/src/autoresponder.ts` — media with `caption = cfg.caption ?? cfg.text`;
     the "media-only requires Plan 7" guard is removed (text-only, media-only, and
     media+caption all valid; nothing configured → no send).
  4. `apps/worker/src/follow-up-tick.ts` — step media with `caption = step.text`.
  5. inbound integrations: `apps/ingest/src/inbound.ts` passes the integration's
     `mediaAssetId` into the job; `apps/worker/src/inbound-send.ts` resolves and
     sends media with `caption = rendered text`.

## Error handling

- Asset deleted / cross-workspace id → resolver returns null → text fallback
  (or skip for autoresponder media-only).
- Send failures keep each surface's existing behaviour (bot logs, enrolment
  failed status, inbound log + BullMQ retry).

## Testing

- Unit: resolver URL shape + tenant scoping + null on missing (mocked prisma).
- Existing integration tests extended: one media-path test per surface
  (mock `@evo/send`, assert media payload with caption).
