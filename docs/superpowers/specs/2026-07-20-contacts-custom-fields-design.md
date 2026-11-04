# Contacts — capture & surface imported custom fields

**Date:** 2026-07-20
**Status:** Approved (brainstorming) — ready to build

## Goal

Turn the Contacts page from a bare name+phone list into a useful mini-directory by (1) **capturing every extra column** on import into the contact's `customFields`, (2) showing a **user-chosen summary line** under each name, and (3) opening a **detail panel** with all fields when a row is clicked.

## Why

Tenants import rich spreadsheets (email, student no, program, semester, parent phone, address, bill…), but the importer keeps only phone+name and the list shows only `name · phone`. All the imported value is discarded and invisible.

## Approach

No schema change — `Contact.customFields` (`Json?`) already exists. Three focused changes: the import route, the contacts server page's data, and a new client view (list + picker + detail drawer).

### 1. Import — auto-capture extra columns → `customFields`
In `apps/web/src/app/api/workspaces/[slug]/contacts/import/route.ts`, when the file **has a header** (i.e. `startIdx === 1`), build a `customFields` object per row from every column **except** the detected phone and name columns, keyed by the trimmed header name, skipping empty values. Store it on the contact:
- `create: { phoneE164, name, customFields }`
- `update: { name, customFields }` (merge/replace — replace is fine; re-import refreshes)
Headerless pastes capture no custom fields (only phone/name). Cap the stored object to a sane size (e.g. skip if a value > 500 chars, and at most ~30 keys) to avoid abuse.

### 2. Contacts page data
`apps/web/src/app/[workspaceSlug]/contacts/page.tsx` already returns all scalar fields (incl. `customFields`) via `findMany`. Pass the contacts (with `customFields` + labels) to a new client `<ContactsView>`. Compute nothing server-side beyond what's loaded.

### 3. `<ContactsView>` client component (`contacts/contacts-view.tsx`)
- **Field keys:** union of all `customFields` keys across the loaded contacts → the available fields for the picker.
- **"Fields ▾" picker** (top of the list): a dropdown of checkboxes of the available field keys; the chosen keys are saved in `localStorage` per workspace (key `contacts-fields:{slug}`). Default: the first 2 non-empty text-ish keys (skip values that are `TRUE`/`FALSE`, or longer than 40 chars) — a sensible starting point until the user picks.
- **Row:** name (bold) · phone; a muted **second line** rendering the chosen fields as `Label: value · Label: value` (skip empties, truncate the line). The whole row is a **button** that opens the detail drawer.
- **Detail drawer** (slide-over `Dialog`/panel): shows the contact's name, phone (with a copy button), labels, and **all** `customFields` as a two-column labelled list. Long values (address) wrap. Read-only in v1.
- Theme tokens only (dark/light), no jargon.

## Scope

**In:** import capture, the chosen summary line + field picker (persisted), the click-to-open detail drawer (read-only), theme compliance.

**Out (YAGNI):** editing custom fields inline; a dedicated contact URL/page; searching *inside* customFields (JSON search); per-field types/validation; column mapping UI on import (auto-capture covers it).

## Testing

- **Route unit-ish / manual:** importing the sample docket file stores `Email`, `Program Code`, `Current Semester`, etc. into `customFields`; re-import updates them; headerless paste stores none.
- **Component:** `<ContactsView>` renders the second line from chosen fields; the picker persists to localStorage and re-renders; clicking a row opens the drawer with all fields; empty/no-custom-field contacts render cleanly (just name·phone).
- **Manual:** on prod with the real imported data, the list shows the chosen fields and the drawer shows everything.

## Success criteria

After importing a spreadsheet, a tenant sees a chosen summary (e.g. Email · Program) on each contact and can click any contact to see every field they imported — no data lost, no setup beyond ticking which fields to show.
