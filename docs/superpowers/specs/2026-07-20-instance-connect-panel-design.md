# Instance "Connect to n8n" panel — Design Spec

**Date:** 2026-07-20
**Status:** Approved (brainstorming) — ready for implementation planning

## Goal

Make it effortless for a non-technical tenant to get **every credential needed to send from n8n / Zapier / Make** from a single, copy-paste-ready panel on each instance page — eliminating the current hunt across the hidden API-keys page, the workspace slug, the instance name, and the Bearer format. Also stop the existing "API credentials" box (raw Evolution engine key) from misleading people into using the wrong key.

## Why (the problem)

To send via the public `/send` endpoint today, a tenant must independently discover: (1) their workspace **slug**, (2) the **instance name**, (3) create a workspace **API key** on a page only reachable via API Docs, and (4) guess the **`Authorization: Bearer ek_…`** format. Worse, the instance page shows an "API credentials" box with the **Evolution engine GUID key** labeled "for n8n" — but that key does **not** work with `/send`, which actively misled the user.

## Approach

A **"Connect to n8n"** card on each instance detail page (`/[workspaceSlug]/instances/[id]`), everything pre-filled and copy-buttoned. The raw Evolution credentials move into a collapsed **Advanced** section so they stop competing with the friendly path.

**No new backend endpoints.** The card reuses:
- `POST /api/workspaces/[slug]/api-keys` — already creates a key and returns the raw `ek_…` **once**.
- `GET /api/workspaces/[slug]/api-keys` — returns the list (for the "you have N keys" count).
- The instance's `evolutionInstanceName` + the workspace `slug` (both already on the page) build the URL client-side.

## The card contents (top → bottom)

All rows have a copy button; colours use theme tokens (dark/light aware).

1. **Send URL** — read-only, pre-filled with the real slug + instance name:
   `POST {origin}/api/workspaces/{slug}/instances/{evolutionInstanceName}/send`
2. **API key** — the one interactive part:
   - A **"Create API key"** button → calls `POST /api-keys` → reveals the returned raw `ek_…` **inline, once**, with a copy button and a note *"Shown once — copy and store it safely. Works for your whole workspace."*
   - Below it: *"You have {N} key(s) · Manage"* linking to `/{slug}/settings/api-keys` (uses the GET count; N may be 0).
3. **Auth header** — read-only: `Authorization: Bearer ek_…` (with a small hint that `ek_…` is the key from step 2).
4. **Body examples** — two copy blocks: text (`{ "number": "60…", "text": "…" }`) and image (`{ "number": "60…", "type": "image", "media_url": "https://…", "message": "…" }`), matching the alias fields the `/send` endpoint accepts.
5. **Copy as cURL** — one button copies a complete working command: the POST URL, the `Authorization: Bearer <key>` header (the just-created key if present, else `ek_YOUR_KEY`), and a sample JSON body.
6. **Advanced — Direct engine access (collapsed `<details>`):** the existing `InstanceCredentials` (Evolution instance name + engine GUID key), relabelled *"For calling the WhatsApp engine directly — most people don't need this. Use the fields above for n8n."*

## Components & data flow

- **New client component** `apps/web/src/app/[workspaceSlug]/instances/[id]/connect-panel.tsx` — receives `{ workspaceSlug, origin, instanceName, keyCount }`; owns the Create-key call + reveal state + all copy buttons. Reuses the `CopyButton` pattern from `credentials.tsx` (extract it to share, or duplicate the tiny helper).
- **Modify** `instances/[id]/page.tsx` (server) — compute `origin` (from `headers()` like the docs page), fetch the workspace's API-key count (`prisma`/tenantClient count of `ApiKey` for the workspace), pass to `<ConnectPanel>`; move the existing `<InstanceCredentials>` into the Advanced `<details>` inside the panel (or render it there).
- **Keep** `credentials.tsx` (`InstanceCredentials`) as-is, just relocated under Advanced.

## Scope

**In:** the Connect card (URL, inline Create-key + reveal-once + copy, auth header, body examples, Copy-as-cURL), relabelling + demoting the Evolution creds to Advanced, theme-token compliant, no jargon.

**Out (YAGNI):** listing every API endpoint on the instance page (that's what API Docs is for); a full n8n workflow export/import; per-instance keys (keys stay workspace-scoped); editing/rotating keys inline (Manage link covers that).

## Testing

- **Component:** the card renders the correct pre-filled URL from props; "Create API key" calls `POST /api-keys` and reveals the returned raw key once; Copy-as-cURL produces a well-formed command; the Advanced section is collapsed by default.
- **Manual/E2E:** on a real instance page, Create a key → paste the cURL into a terminal → a message sends (happy path already proven by the `/send` work).

## Success criteria

A tenant opens their instance page, clicks **Create API key**, copies the key and the cURL/URL, pastes into n8n, and sends — without visiting any other page or asking what a "slug", "instance name", or "Bearer" is.
