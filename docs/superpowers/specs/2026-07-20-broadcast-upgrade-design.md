# Broadcast upgrade — audience lists, personalization, media

**Date:** 2026-07-20
**Status:** Approved — build in order A → B → C, deploying each.

Turns Broadcasts into a real tool: send a **personalized image** message to an **imported contact list**. Three sub-features; each ships independently.

## A. Audience / Lists (no schema change — `ContactList` / `ContactListMember` exist)

- **Import → add to a list.** `contacts/import/route.ts` accepts an optional `listName`. After upserting the surviving contacts, find-or-create the `ContactList` by name (tenant-scoped) and add all their ids as `ContactListMember` (`skipDuplicates`). The import wizard gets an *"Add these contacts to a list (optional)"* text input with a datalist of existing list names; blank = general pool only.
- **Lists page** at `/[workspaceSlug]/lists` (nav item "Lists" in the Audience group). Server page lists `ContactList`s with member counts; a client panel to **create** a list (`POST /lists`) and **delete** one (`DELETE /lists/{id}` — add if missing). Read-only member counts in v1.
- The broadcast wizard already shows lists with counts — no change; it now shows the new lists.

## B. Personalization at send time

- In `apps/worker/src/broadcast-scheduler.ts`, where the per-recipient send job is built, render the template body **per contact** with `renderTemplate` (from `@evo/inbound-templating`) against a payload of `{ name, phone, ...customFields }`.
- **Tags:** `{{name}}`, `{{phone}}`, and each custom-field key by name, e.g. `{{Program Code}}`. Missing → empty string (existing `renderTemplate` behaviour). The scheduler must load each contact's `name` + `customFields` (currently it may only have the phone/list membership — extend the query to include the Contact row).
- **Editor help:** pass available variables into the template editor's `{{..}}` menu — `name`, `phone`, plus the union of custom-field keys across the workspace's contacts (fetched for the templates page). Non-blocking if the list is empty.

## C. Media in broadcasts

- Add `mediaAssetId String?` to the `Broadcast` model (migration). The broadcast wizard gets a **media picker** (reuse the existing `MediaPicker` component used by chatbot/autoresponder) — optional; picks a `MediaAsset` from File Manager.
- `broadcasts/route.ts` create schema accepts `mediaAssetId`. The scheduler/send path: if the broadcast has a media asset, send **media** (image/etc.) with the rendered template body as the **caption**; else send text as today. Reuse `sendViaInstance` media payload (as the chatbot media send does).
- Template stays text-only, so one template can go out with different images per broadcast.

## Scope / non-goals

**In:** the three above. **Out:** list segmentation/filters, per-list scheduling, media inside templates (broadcast-level only), rich merge-tag fallbacks/defaults, WhatsApp interactive buttons.

## Testing

- **A:** import with a `listName` creates the list + memberships; re-import doesn't duplicate members; Lists page shows counts; broadcast wizard lists it.
- **B:** `renderTemplate("Hi {{name}}, program {{Program Code}}", {name:"Ali", "Program Code":"DCA"})` → "Hi Ali, program DCA"; a broadcast to 2 contacts sends 2 differently-rendered bodies; missing field → blank.
- **C:** a broadcast with a `mediaAssetId` sends media with the rendered caption; without it, text as before; migration applies cleanly.

## Success

A tenant imports a spreadsheet into a named list, writes "Hi {{name}}, your {{Program Code}} docket is ready 📄" with an attached image, and every recipient gets a personalized image message.
