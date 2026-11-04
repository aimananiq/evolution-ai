# Evolution Manager — UI Design Brief

**Handoff document for design-Claude.** Paste this file (plus dashboard and inbox screenshots) into a new session and ask for screens one at a time. Every section is fully written; there are no placeholders.

---

## 1. Product Summary

Evolution Manager is a multi-tenant manager UI for [Evolution API](https://github.com/EvolutionAPI/evolution-api) (WhatsApp). Agencies and schools use it to run WhatsApp at scale across multiple phone numbers ("instances"):

- **Connect numbers** — register WhatsApp instances via QR-code pairing.
- **Team inbox** — shared conversation list with chat-thread view; agents pick up inbound messages and reply.
- **Contacts** — searchable contact list with label tagging; bulk CSV import.
- **Templates** — reusable message bodies with variable placeholders; required for broadcasts.
- **Broadcasts** — bulk-send a template to a contact list; live delivery-status tracking (queued → sending → delivered → read / failed).
- **Drip automation** — multi-step sequences sent to enrolled contacts on a configurable schedule.
- **Chatbot automation** — per-instance keyword triggers with optional AI fallback.
- **Warmer** — gradual warm-up of new numbers by exchanging low-volume messages between instances to build sending reputation.
- **Analytics** — message volume, broadcast delivery funnel, warmer activity.
- **Settings** — workspace members/roles, billing plan, quick replies, API keys, integrations (Chatwoot pass-through, AI provider keys), outbound webhooks, audit log.
- **Admin panel** — super-admin views for all workspaces, users, plan definitions, and system health.

**Stack:** Next.js 15 (App Router, React Server Components), Prisma + Postgres, Auth.js v5, BullMQ + Redis, Socket.IO, next-intl (en-GB), shadcn/ui + Tailwind CSS. Docker-compose orchestration, Caddy at the edge.

**Primary users:**
- **Owner / Admin** — full access: setup, instances, members, billing, all settings.
- **Agent (Viewer)** — inbox, contacts, broadcasts (read), analytics. No settings access.

**Tone:** Professional, calm, trustworthy. These are real messages to real customers. No playful language, no confetti. Think: a well-run operations tool, not a consumer app.

---

## 2. Visual Direction

### Theme: WhatsApp-native, dark-first

The app renders dark by default (no class toggling required). The `:root` palette _is_ the dark palette. A `.light` swap exists in the CSS but is not yet surfaced in the UI.

### Two surface registers

| Surface | Applies to | Reference |
|---|---|---|
| **WhatsApp messaging** | Inbox conversation list, chat-thread, bubble composer | `chat-thread.tsx` |
| **Product dashboard** | All other screens: tables, forms, stat tiles, charts | `dashboard/page.tsx` |

### Messaging surfaces
Emulate WhatsApp Web / WhatsApp Desktop dark mode exactly:
- Deep background (`#0B141A`), panel sidebar (`#111B21`), hover row (`#202C33`).
- Outbound bubbles: `#005C4B` (dark teal). Inbound bubbles: a slightly lighter panel (`~#1F2C34`).
- Timestamps inside bubbles, right-aligned, `10px`, muted.
- No border radius on the entire pane — full-height split layout, left panel = conversation list, right panel = thread.

### Dashboard / product surfaces
Apply Linear/Resend-grade polish:
- 8px spacing rhythm throughout.
- Tight typographic hierarchy: `text-2xl font-semibold` heading, `text-sm text-muted-foreground` subtitle, `text-sm` body.
- Cards with `bg-card` background and `border` dividers — no heavy drop-shadows.
- Tables with `border-border` row separators, `bg-secondary` header row.
- Restrained motion: `transition-colors duration-150` on interactive elements only. No entrance animations.
- Green (`bg-primary`, `#00A884`) used sparingly: primary action buttons, active nav item indicator, positive delta badges. Nowhere else.

### Explicit DOs and DON'Ts

**DO:**
- High-contrast body text (`text-foreground` = `#E9EDEF`) on dark surfaces.
- Use `text-muted-foreground` (`#8696A0`) for captions, metadata, helper text.
- Generous breathing room inside cards (`p-4` to `p-6`).
- Consistent icon size: `h-4 w-4` inline, `h-5 w-5` in stat tiles and nav.
- Status pills with semantic colours: green = connected/active, amber = warming/pending, red = error/disconnected, grey = stopped/idle.

**DON'T:**
- Rainbow accent colours or gradients.
- Heavy `box-shadow` or `drop-shadow` on cards.
- Hard-coded colour values — always use token classes.
- Emoji as decoration (only in WhatsApp-context bubbles where the user typed them).
- Hard-coded English strings — all copy must come from `apps/web/messages/en-GB.json` via `useTranslations()` / `getTranslations()`.

---

## 3. Design Tokens

All tokens are defined as CSS custom properties in `apps/web/src/app/globals.css`. Tailwind maps them to utility classes. **Never hard-code hex values; always use the token classes.**

### Core palette (dark default)

| Token | CSS var | Hex equivalent | Tailwind class |
|---|---|---|---|
| Background (base) | `--background` | `#0B141A` | `bg-background` |
| Card / raised panel | `--card` | `#111B21` | `bg-card` |
| Hover / secondary | `--secondary` | `#202C33` | `bg-secondary` |
| Primary (WA green) | `--primary` | `#00A884` | `bg-primary` |
| Sidebar | `--sidebar` | `#0D171D` | `bg-sidebar` |
| Foreground (text) | `--foreground` | `#E9EDEF` | `text-foreground` |
| Muted foreground | `--muted-foreground` | `#8696A0` | `text-muted-foreground` |
| Border | `--border` | `~#1E2D35` | `border-border` |
| Ring / focus | `--ring` | `#00A884` | `ring-ring` |
| Destructive | `--destructive` | `hsl(0 72% 51%)` | `bg-destructive` |
| Radius | `--radius` | `0.625rem` | `rounded-[var(--radius)]` via shadcn |

### Bubble tokens

| Token | CSS var | Usage | Tailwind class |
|---|---|---|---|
| Outbound bubble | `--bubble-out` | `#005C4B` sent messages | `bg-bubble-out` |
| Inbound bubble | `--bubble-in` | `~#1F2C34` received messages | `bg-bubble-in` |

### Token rules for generated code

1. Use `bg-background`, `bg-card`, `bg-secondary`, `bg-primary`, `bg-bubble-out`, `bg-bubble-in`.
2. Use `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`.
3. Use `border-border` for all dividers, `ring-ring` for focus outlines.
4. Import and compose with `cn()` from `@/lib/utils`.
5. All primitives are in `@/components/ui/*` — see Section 5 for the full list.

---

## 4. Screen Inventory

Routes are derived from `apps/web/src/app/`. Each entry covers: **purpose**, **key data shown**, **primary actions**, and **states** (empty / loading / error).

Reference screens already built are marked **[DONE — reference]**. Design output for non-DONE screens must pattern-match those references.

---

### Auth group — `(auth)/`

#### `/sign-in`
- **Purpose:** Email + password authentication entry point.
- **Data shown:** Email field, password field, error message (inline, `text-destructive`). Link to sign-up. Optional `?next=` redirect preserved.
- **Actions:** Submit credentials (calls Auth.js credentials provider). Navigate to sign-up.
- **States:** Default; submitting (button disabled + spinner); error (inline message below password field); redirecting.

#### `/sign-up`
- **Purpose:** New user registration.
- **Data shown:** Name, email, password, confirm-password fields. Link back to sign-in.
- **Actions:** Create account, redirect to `/onboarding`.
- **States:** Default; submitting; validation errors per field; success (redirect).

#### `/accept-invite/[token]`
- **Purpose:** Accept a workspace invitation sent by email. The token is pre-filled from the URL.
- **Data shown:** Workspace name (decoded from token), invited email, role being granted. If the user is not signed in, also shows sign-in / sign-up prompt.
- **Actions:** Accept invitation (creates membership and redirects to workspace dashboard). Decline (navigates to sign-in).
- **States:** Loading (resolving token); invalid/expired token (full-page error with re-invite suggestion); already a member (info state with redirect link); success (redirect).

---

### Onboarding — `/onboarding`

- **Purpose:** First-run workspace creation. Reached after sign-up if the user has no workspace.
- **Data shown:** Single text field for workspace name. Explanation copy about what a workspace is.
- **Actions:** Create workspace (POST `/api/workspaces`), then redirect to `/{slug}/dashboard`.
- **States:** Default; submitting (button disabled); API error (inline); success (redirect). The form is a centered card on `bg-background`, not wrapped in the nav shell.

---

### Workspace group — `/[workspaceSlug]/`

All workspace screens render inside the nav shell (left sidebar + topbar). The sidebar highlights the active route item.

#### `/[workspaceSlug]/dashboard` — **[DONE — reference]**
- **Purpose:** At-a-glance workspace health snapshot.
- **Data shown:** 4 stat tiles (messages, contacts, delivery rate, connected instances); 7-day message activity bar chart (recharts); recent activity list.
- **Actions:** Navigate to sub-sections via tiles (clickable). Chart date-range selector (future).
- **States:** Loading (Skeleton tiles + chart placeholder); data populated; empty (zero-state copy in activity list).
- **Reference file:** `apps/web/src/app/[workspaceSlug]/dashboard/page.tsx`

#### `/[workspaceSlug]/inbox`
- **Purpose:** Shared team inbox — list of all WhatsApp conversations across instances.
- **Data shown:** Conversation list (contact name, last message preview, timestamp, unread badge, instance label). Selected conversation loads the chat thread.
- **Actions:** Click conversation to open thread. Filter by instance / unread / assigned agent. Mark as resolved. Assign to self or another agent.
- **States:** Empty (no conversations yet, with CTA to connect an instance); loading (Skeleton rows); conversation selected (two-panel layout); no conversation selected (right panel shows empty state illustration + prompt).

#### `/[workspaceSlug]/inbox/[conversationId]` — **[DONE — reference]**
- **Purpose:** Full chat-thread view for a specific conversation.
- **Data shown:** Contact avatar + name in header; ordered message bubbles (outbound `bg-bubble-out`, inbound `bg-bubble-in`); each bubble shows body text + timestamp.
- **Actions:** Type and send a message (text composer). Attach media (future). Quick-reply picker (dropdown from saved quick replies). Assign / resolve controls in header.
- **States:** Loading (Skeleton bubbles); populated; empty thread (contact opened but no messages); send error (toast).
- **Reference file:** `apps/web/src/components/inbox/chat-thread.tsx`

#### `/[workspaceSlug]/contacts`
- **Purpose:** Browse and search the workspace contact list.
- **Data shown:** Table of contacts — name (or phone if no name), E.164 phone number, label badges (coloured pills), last updated. Pagination.
- **Actions:** Search/filter contacts. Click row to open contact detail (future). Import contacts (link to `/contacts/import`). Add single contact (modal).
- **States:** Empty (no contacts, CTA to import); loading (Skeleton rows); populated table; search/filter applied (result count shown).

#### `/[workspaceSlug]/contacts/import`
- **Purpose:** Bulk import contacts from a CSV file.
- **Data shown:** File drop zone. Column-mapping step (after upload, map CSV columns to name / phone / labels fields). Preview of first 5 rows post-mapping. Import progress (count imported / failed).
- **Actions:** Upload CSV. Map columns. Confirm import. Cancel (back to contacts list).
- **States:** Step 1 — file selection; Step 2 — column mapping; Step 3 — preview + confirm; Step 4 — importing (progress indicator); Step 5 — done (success count + errors table); upload error.

#### `/[workspaceSlug]/templates`
- **Purpose:** Manage reusable message templates with variable placeholders (`{{1}}`, `{{name}}`).
- **Data shown:** List of templates — name, body preview (truncated), created date. Inline edit form (expand on click).
- **Actions:** Create new template (inline form or modal). Edit template (inline). Delete template (confirm dialog). Copy template body.
- **States:** Empty (no templates, CTA); loading; populated list; edit mode (inline expanded form); delete confirm dialog.

#### `/[workspaceSlug]/broadcasts`
- **Purpose:** List all broadcast campaigns in reverse-chronological order.
- **Data shown:** Table — name, target list, target count, status pill (draft / queued / sending / sent / failed), created date.
- **Actions:** Create new broadcast (link to `/broadcasts/new`). Click row to open detail. Duplicate broadcast (row action).
- **States:** Empty (no broadcasts, CTA); loading; populated table; status filter applied.

#### `/[workspaceSlug]/broadcasts/new`
- **Purpose:** Wizard to create and schedule a new broadcast.
- **Data shown:** Step 1 — name, select template (dropdown from saved templates), select contact list or label filter. Step 2 — preview (rendered template with sample variables). Step 3 — schedule (send now or pick datetime).
- **Actions:** Move between steps. Preview rendered message. Submit (POST, creates broadcast, enqueues job). Cancel.
- **States:** Each step has validation; submitting (button spinner); success (redirect to broadcast detail); API error (toast + stay on form).

#### `/[workspaceSlug]/broadcasts/[id]`
- **Purpose:** Detail view and live status tracking for a single broadcast.
- **Data shown:** Broadcast name, template used, contact list, scheduled time, created by. Delivery funnel stats (queued / sending / sent / delivered / read / failed counts). Per-target status table (phone number, status, last updated).
- **Actions:** Cancel broadcast (if status is queued/sending). Retry failed targets (if status is failed). Export results as CSV.
- **States:** Loading; live (auto-refreshes delivery counts via polling or socket); completed; failed; cancelled.

#### `/[workspaceSlug]/automation`
- **Purpose:** Hub page listing automation sub-sections.
- **Data shown:** Two navigation cards — Chatbots, Drip Campaigns. Brief description of each.
- **Actions:** Navigate to chatbots or drip campaigns.
- **States:** Static; no empty or loading states.

#### `/[workspaceSlug]/automation/chatbot`
- **Purpose:** List all WhatsApp instances and their chatbot configuration status.
- **Data shown:** Table of instances — label, chatbot enabled/disabled badge, trigger count, fallback AI model (if set).
- **Actions:** Click row to open chatbot editor for that instance (`/automation/chatbot/[id]`).
- **States:** Empty (no instances, CTA to create one); loading; populated.

#### `/[workspaceSlug]/automation/chatbot/[id]`
- **Purpose:** Configure the chatbot for a specific instance — keyword triggers, AI fallback, enabled toggle.
- **Data shown:** Instance name in heading. Enable/disable toggle. Trigger list (keyword → reply body, with match mode). AI fallback section (provider, model, system prompt).
- **Actions:** Add trigger (inline form). Edit trigger. Delete trigger (row action). Toggle enabled. Save AI settings. Save all.
- **States:** Loading; populated; unsaved changes indicator; saving (button spinner); save error (toast); instance has no chatbot yet (empty state with quick-start CTA).

#### `/[workspaceSlug]/automation/drip`
- **Purpose:** List all drip campaigns.
- **Data shown:** Table — campaign name, linked instance, enrolled contact count, status pill (draft / active / paused / archived).
- **Actions:** Create new campaign (`/automation/drip/new`). Click row to open detail. Archive campaign (row action).
- **States:** Empty; loading; populated.

#### `/[workspaceSlug]/automation/drip/new`
- **Purpose:** Create a new drip campaign.
- **Data shown:** Name field. Instance selector. Step builder (ordered list of steps: delay duration + template picker). Contact enrolment options (manual list, label filter, or webhook trigger).
- **Actions:** Add/remove/reorder steps. Select template per step. Set delay between steps. Save as draft. Activate immediately.
- **States:** Empty form; steps added; validation errors; saving; success (redirect to campaign detail).

#### `/[workspaceSlug]/automation/drip/[id]`
- **Purpose:** Detail and management view for a single drip campaign.
- **Data shown:** Campaign name, instance, status. Step timeline visualisation (step number, delay, template preview). Enrolment table (contact, enrolled at, current step, next send time, status).
- **Actions:** Edit campaign (navigate to edit view or inline). Pause / resume / archive campaign. Enrol contacts manually. Remove enrolment.
- **States:** Loading; active campaign with enrolments; empty enrolments (CTA to enrol); paused; archived (read-only banner).

#### `/[workspaceSlug]/warmer`
- **Purpose:** List all warmer profiles and manage warm-up templates.
- **Data shown:** Profile list — name, running/stopped status pill. Below the list: warm-up template library (message bodies used during warm-up exchanges).
- **Actions:** Create new profile (`/warmer/new`). Click profile to open detail. Add/edit/delete warm-up templates (inline panel).
- **States:** Empty profiles (CTA); loading; populated; template panel edit mode.

#### `/[workspaceSlug]/warmer/new`
- **Purpose:** Create a new warmer profile.
- **Data shown:** Name field. Select source instances (instances that will send warm-up messages). Set daily volume ramp (start count, ramp step, max per day). Select message template pool.
- **Actions:** Fill form. Save (creates profile). Start immediately option.
- **States:** Default form; validation; saving; success (redirect to profile detail).

#### `/[workspaceSlug]/warmer/[id]`
- **Purpose:** Detail and control panel for a single warmer profile.
- **Data shown:** Profile name, selected instances, ramp schedule, current day count, total sends to date. Run history table (run id, started at, ended at, status, messages sent). Mini activity chart (sends per day, last 14 days).
- **Actions:** Start new run. Stop active run. Edit profile settings. Delete profile (confirm dialog).
- **States:** Loading; stopped (no active run, start CTA prominent); running (stop button, live count updates); completed run history; no runs yet (empty history state).

#### `/[workspaceSlug]/analytics`
- **Purpose:** Root redirect — navigates immediately to `/analytics/messages`. No visible content.

#### `/[workspaceSlug]/analytics/messages`
- **Purpose:** Inbound vs outbound message volume over the last 30 days.
- **Data shown:** Stacked or grouped bar chart (daily buckets, two series: inbound / outbound). Summary tiles above chart (total inbound, total outbound, net). Date range selector.
- **Actions:** Change date range. Toggle series visibility (chart legend clickable).
- **States:** Loading (Skeleton chart); no data (empty state with hint about connecting an instance); populated.

#### `/[workspaceSlug]/analytics/broadcasts`
- **Purpose:** Broadcast delivery funnel across all campaigns.
- **Data shown:** Horizontal bar or funnel chart showing cumulative counts: queued → sending → sent → delivered → read → failed.
- **Actions:** Filter by broadcast campaign (dropdown). Export chart data.
- **States:** Loading; no broadcasts sent yet (empty state); populated.

#### `/[workspaceSlug]/analytics/warmer`
- **Purpose:** Warm-up activity over the last 14 days.
- **Data shown:** Line chart of sends per day across all warmer profiles. Summary tile (total sends this period).
- **Actions:** Filter by warmer profile. Toggle profiles on chart.
- **States:** Loading; no warmer runs yet (empty state); populated.

#### `/[workspaceSlug]/instances`
- **Purpose:** List all WhatsApp instances (phone numbers) in the workspace.
- **Data shown:** Table — label, phone number (if paired), connection state pill (open/connecting/close), QR-pair link if not connected.
- **Actions:** Create new instance (`/instances/new`). Click row to open detail. Delete instance (row action, confirm dialog).
- **States:** Empty (no instances, CTA to create); loading; populated; connection state live-updating (Socket.IO).

#### `/[workspaceSlug]/instances/new`
- **Purpose:** Register a new Evolution API instance name.
- **Data shown:** Name/label field. Instance name field (used as the Evolution API key). Optional description.
- **Actions:** Submit (creates instance record, calls Evolution API to create instance). Cancel.
- **States:** Default; submitting; error (Evolution API unreachable or name conflict); success (redirect to pair page).

#### `/[workspaceSlug]/instances/[id]`
- **Purpose:** Full detail and management for a single instance.
- **Data shown:** Label, phone number, connection state pill, Evolution API instance name. Action buttons. Linked chatbot summary. Linked drip campaigns summary.
- **Actions:** Open pair/QR page. Send test message (`/instances/[id]/test-send`). Restart connection (API call). Delete instance (confirm dialog).
- **States:** Loading; connected (green pill, phone visible); disconnected (amber/red pill, pair CTA prominent); error.

#### `/[workspaceSlug]/instances/[id]/pair`
- **Purpose:** QR-code pairing flow to link a WhatsApp number to the instance.
- **Data shown:** Large QR code image (polled from Evolution API every 30 s or via socket). Timer countdown until QR expires. Step-by-step instructions (open WhatsApp → Linked devices → Scan QR).
- **Actions:** Scan QR with phone. Regenerate QR (if expired). Cancel (back to instance detail).
- **States:** Loading QR; QR displayed (30-second refresh timer visible); QR expired (regenerate button); scanning in progress (spinner + "waiting for phone" message); paired (success state with redirect prompt); error (Evolution API unreachable).

#### `/[workspaceSlug]/instances/[id]/test-send`
- **Purpose:** Send a one-off test message from this instance to verify connectivity.
- **Data shown:** Instance name + connection state in heading. Phone number input (E.164). Message body textarea.
- **Actions:** Send message (calls Evolution API send endpoint). View result (success/failure inline).
- **States:** Default; sending; success (response preview); error (API error message inline).

#### `/[workspaceSlug]/groups`
- **Purpose:** Read-only browser of WhatsApp groups the connected instances belong to. Groups are fetched live from the Evolution API — they are not stored in the database.
- **Data shown:** Instance selector dropdown. Table of groups — group name, participant count, creation date. Filtered per selected instance.
- **Actions:** Select instance. Refresh group list. Copy group JID (row action).
- **States:** No instances connected (empty state); loading groups (Skeleton table); groups loaded; API error (toast + stale data warning).

---

### Settings group — `/[workspaceSlug]/settings/`

All settings screens render inside the settings layout: a secondary left-nav tab list (Members / Plan / Quick Replies / API Keys / Integrations / Audit Log / Webhooks) within the main nav shell.

#### `/[workspaceSlug]/settings/members`
- **Purpose:** Manage workspace members and pending invitations. Admin only.
- **Data shown:** Member table (name, email, role badge, you-indicator, remove button). Pending invitations table (email, role, invite token, expiry). Invite form.
- **Actions:** Invite new member (email + role, sends email). Remove member (confirm dialog). Change member role (dropdown, row action). Revoke invitation.
- **States:** Loading; populated; empty (owner only, no other members — invite CTA); invite sending (button spinner); invite sent (success toast).

#### `/[workspaceSlug]/settings/plan`
- **Purpose:** View current subscription plan and usage against limits.
- **Data shown:** Plan name and description. Usage bars: contacts used / cap, instances used / cap, monthly messages used / cap. Feature flags included in plan (checklist). Upgrade/downgrade CTA.
- **Actions:** Contact sales or upgrade (external link, no in-app checkout yet).
- **States:** Loading; plan loaded; over quota (destructive usage bar + warning banner).

#### `/[workspaceSlug]/settings/quick-replies`
- **Purpose:** Manage saved quick-reply shortcuts available in the inbox composer.
- **Data shown:** List of quick replies — shortcut key (e.g. `/thanks`), full message body. Inline edit form.
- **Actions:** Add quick reply. Edit quick reply (inline). Delete quick reply (row action, confirm).
- **States:** Empty (no quick replies, CTA); loading; populated; inline edit expanded.

#### `/[workspaceSlug]/settings/api-keys`
- **Purpose:** Create and manage workspace-scoped API keys for programmatic access.
- **Data shown:** Table of API keys — name, prefix (first 8 chars of key), created date, last used, revoke button. New key creation form (name field only; key revealed once on creation).
- **Actions:** Create new key (POST, reveal secret once in a modal). Revoke key (confirm dialog).
- **States:** Empty (no keys); loading; populated; key just created (one-time reveal modal — copy prompt, token hidden thereafter).

#### `/[workspaceSlug]/settings/integrations`
- **Purpose:** Hub listing available third-party integrations.
- **Data shown:** Two integration cards: AI Provider Keys, Chatwoot (pass-through). Each card shows connection status badge.
- **Actions:** Navigate to each integration's configuration page.
- **States:** Static hub; no dynamic states.

#### `/[workspaceSlug]/settings/integrations/ai`
- **Purpose:** Configure API keys for AI providers used by the chatbot fallback.
- **Data shown:** Provider selection (OpenAI, Anthropic, others). API key input (masked after save). Model selection per provider. Test connection button.
- **Actions:** Save provider key. Delete key. Test connection.
- **States:** Loading; not configured; configured (key masked, last tested timestamp); test in progress; test success; test failed.

#### `/[workspaceSlug]/settings/integrations/chatwoot`
- **Purpose:** Configure Chatwoot pass-through: route inbound messages to a Chatwoot instance.
- **Data shown:** Chatwoot base URL field. API token field (masked after save, encrypted at rest). Inbox ID field. Enabled/disabled toggle.
- **Actions:** Save configuration. Toggle enabled. Test connection.
- **States:** Loading; not configured; configured (token masked); saving; test result (success/fail inline).

#### `/[workspaceSlug]/settings/audit`
- **Purpose:** Immutable audit trail of admin actions within the workspace.
- **Data shown:** Table — actor (email), action (e.g. `member.invite`, `instance.delete`), target resource, IP address, timestamp. Filterable by actor, action type, and date range.
- **Actions:** Filter/search. Export as CSV.
- **States:** Loading; populated (reverse-chronological); empty (no audit events yet, informational).

#### `/[workspaceSlug]/settings/webhooks`
- **Purpose:** Manage outbound webhook subscriptions that fire on workspace events.
- **Data shown:** List of webhook subscriptions — URL, subscribed event types (multi-select tags), enabled toggle, created date. Add/edit form (URL + event type multi-select).
- **Actions:** Add subscription. Edit subscription (inline or modal). Toggle enabled. Delete subscription. Test delivery (send a sample payload).
- **States:** Loading; empty (no webhooks, CTA); populated; add/edit form open; test delivery result (inline).

---

### Admin group — `/admin/`

Admin screens have their own shell (separate left-nav: Workspaces / Users / Plans / Health). Super-admin only; redirects non-admins.

#### `/admin` (root)
- **Purpose:** Redirect — navigates immediately to `/admin/workspaces`. No visible content.

#### `/admin/workspaces`
- **Purpose:** Super-admin view of all workspaces across the platform.
- **Data shown:** Sortable table — workspace name, plan name, member count, instance count, contact count, created date.
- **Actions:** Search/filter by name. Sort columns. Click row to drill into workspace (future). Export CSV.
- **States:** Loading; populated; empty (no workspaces yet — unlikely but handled).

#### `/admin/users`
- **Purpose:** Super-admin view of all registered users.
- **Data shown:** Table — email, name, workspace count (memberships), super-admin star indicator, joined date.
- **Actions:** Search by email. Toggle super-admin flag (confirm dialog). Suspend user (future).
- **States:** Loading; populated; empty.

#### `/admin/plans`
- **Purpose:** Define and edit subscription plan definitions (Prisma `Plan` model).
- **Data shown:** List of plans — name, kind (free/pro/enterprise), contact cap, instance cap, monthly message cap, feature flags JSON, description.
- **Actions:** Edit plan inline (all fields editable). Add new plan. Delete plan (only if no workspaces on it).
- **States:** Loading; populated; inline edit mode; saving; save error.

#### `/admin/health`
- **Purpose:** Real-time system health dashboard visible only to super-admins.
- **Data shown:** 6 stat tiles — total workspaces, total users, total instances, messages in last 24 h, running warmer runs, running broadcast jobs.
- **Actions:** Refresh (button or auto-refresh every 30 s).
- **States:** Loading (Skeleton tiles); populated; error (fetch failed — show stale data with warning badge).

---

## 5. Component Checklist

Every component listed below either exists already or must be built and added to `apps/web/src/components/`. Import from `@/components/ui/<name>` for primitives.

| Component | Location | Status | Notes |
|---|---|---|---|
| Nav shell (sidebar + topbar) | `components/nav/` | Done | Active item uses `bg-primary` indicator |
| `StatCard` | `components/dashboard/stat-card.tsx` | Done | Icon, value, label, optional delta badge |
| `ActivityChart` | `components/dashboard/activity-chart.tsx` | Done | Recharts `BarChart`, themed with token vars |
| `ChatThread` | `components/inbox/chat-thread.tsx` | Done | `bg-bubble-out` / `bg-bubble-in` |
| `Card`, `CardHeader`, `CardContent`, `CardTitle` | `components/ui/card.tsx` | Done | |
| `Button` | `components/ui/button.tsx` | Done | Variants: default (primary), outline, ghost, destructive |
| `Input` | `components/ui/input.tsx` | Done | |
| `Label` | `components/ui/label.tsx` | Done | |
| `Table`, `TableHeader`, `TableRow`, `TableCell` | `components/ui/table.tsx` | Done | |
| `Dialog`, `DialogContent`, `DialogHeader` | `components/ui/dialog.tsx` | Done | |
| `DropdownMenu` | `components/ui/dropdown-menu.tsx` | Done | |
| `Badge` | `components/ui/badge.tsx` | Done | |
| `Avatar`, `AvatarFallback`, `AvatarImage` | `components/ui/avatar.tsx` | Done | |
| `Skeleton` | `components/ui/skeleton.tsx` | Done | Use for all loading states |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `components/ui/tabs.tsx` | Done | |
| `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` | `components/ui/select.tsx` | Done | |
| `Switch` | `components/ui/switch.tsx` | Done | For enabled/disabled toggles |
| `Textarea` | `components/ui/textarea.tsx` | Done | |
| `Toast` / `Toaster` | `components/ui/toast.tsx` | Done | Via `sonner` configured in root layout |
| **Status pill** | `components/ui/status-pill.tsx` | Needed | `variant`: connected (green), warming (amber), disconnected (red), stopped (grey) — built on `Badge` |
| **Data table** | `components/data-table/` | Needed | Sortable columns, pagination, row actions (DropdownMenu). Use shadcn table primitives. |
| **Empty state** | `components/ui/empty-state.tsx` | Needed | Centered icon (`h-10 w-10 text-muted-foreground`) + heading + caption + optional CTA button. Pattern from inbox empty state. |
| **QR display** | `components/instances/qr-display.tsx` | Needed | `"use client"` component; polls `/api/instances/[id]/qr` every 30 s; shows countdown ring and regenerate button on expiry |
| **Stat tile (admin)** | Re-use `StatCard` | — | Pass no delta for admin tiles |
| **Recharts wrapper** | Per-chart files | Needed | Each chart is a `"use client"` component wrapping recharts, using CSS var token colours via `getComputedStyle` |
| **Conversation list row** | `components/inbox/conversation-row.tsx` | Needed | Avatar, name, last message preview, timestamp, unread count badge |
| **QR pairing wizard** | `components/instances/pair-view.tsx` | Exists (partial) | Style to match token system |
| **CSV column mapper** | `components/contacts/csv-mapper.tsx` | Needed | Step 2 of contacts import |
| **Step builder** | `components/automation/step-builder.tsx` | Needed | Drip campaign step editor: ordered list with drag handle, delay input, template picker |

---

## 6. Stack Constraints

The following rules apply to **all generated code**. Designs that violate these rules cannot be merged.

### Framework
- **Next.js 15 App Router only.** No Pages Router patterns.
- Server Components by default. Add `"use client"` only when a component uses `useState`, `useEffect`, browser events, or third-party client libraries (recharts, socket.io-client).
- `async` server components may `await` Prisma queries and `getTranslations()` directly. Do not introduce an API route just to fetch data that can be fetched in a server component.

### Styling
- **Tailwind CSS utility classes only.** No inline `style={{ color: '...' }}` with raw hex values.
- All colours via the token class system documented in Section 3. Never hard-code `#005C4B` or any hex.
- Spacing follows the 8px rhythm: prefer `p-2` (8px), `p-4` (16px), `p-6` (24px), `gap-4` (16px), `gap-6` (24px).
- Radius: shadcn components use `var(--radius)` internally. For custom elements use `rounded-[var(--radius)]` or `rounded-lg` (which resolves to `0.5rem` — close enough).

### Components
- Import primitives from `@/components/ui/<name>`. Do not copy-paste raw Radix UI or raw HTML form elements.
- Use `cn()` from `@/lib/utils` for conditional class merging.
- Icons: `lucide-react` only. Size `h-4 w-4` inline, `h-5 w-5` in tiles/nav, `h-10 w-10` in empty states.

### Internationalisation
- **All user-visible strings must come from `apps/web/messages/en-GB.json` via next-intl.** In Server Components: `const t = await getTranslations()`. In Client Components: `const t = useTranslations()`. Never write a hard-coded English string in a component file — add a key to `en-GB.json` first.

### Charts
- Use **recharts** for all charts. Wrap in `"use client"` components.
- Colour series using `getComputedStyle(document.documentElement).getPropertyValue('--primary')` so charts respect both dark and light tokens. Never hard-code chart colours.

### Data fetching
- Server components fetch via Prisma (`tenantClient(workspace.id)` for workspace-scoped data, `prisma` for super-admin global data).
- Client components that need live data use SWR or the native `fetch` API against `/api/` routes. Socket.IO is used only for real-time push (inbox messages, instance connection state, warmer run counts).

### Auth / tenancy
- Call `requireMember(workspaceSlug, minRole)` at the top of every workspace server component to enforce tenancy. It returns `{ workspace, userId, role }`.
- Call `requireSuperAdmin()` at the top of every admin server component.

---

## 7. How to Use This Brief

### Setup for the design session

1. Paste this entire file into a new Claude session (claude.ai or Claude Code).
2. Attach a screenshot of the dashboard reference screen (`/[workspaceSlug]/dashboard`).
3. Attach a screenshot of the inbox thread reference screen (`/[workspaceSlug]/inbox/[conversationId]`).

### Ask for screens one at a time

Request each screen individually, for example:

> "Design the `/contacts` screen. Follow the brief exactly."

### Requirements for each generated screen

Generated output must:

**(a) Use only the tokens from Section 3.** No raw hex values. No inline colour styles.

**(b) Import primitives from `@/components/ui/*`.** For example: `import { Card, CardContent } from "@/components/ui/card"` — not a custom `<div className="rounded shadow">`.

**(c) Match the spacing and typographic hierarchy of the reference screens.** Heading: `text-2xl font-semibold`. Subtitle: `text-sm text-muted-foreground mt-1`. Body/table: `text-sm`. Card padding: `p-4` to `p-6`. Gap between sections: `space-y-6`.

**(d) Include all three states: empty, loading (Skeleton), and error.** For Server Components this means: render Skeleton in a `<Suspense>` fallback; handle the empty-array case with an `<EmptyState>` component; surface errors as a toast or inline destructive badge.

**(e) Use next-intl for all copy.** Add new translation keys to `apps/web/messages/en-GB.json`. Reference them with `t("section.key")`. The design session should output the new keys alongside the component code.

**(f) Output implementable React/TSX, not standalone HTML/CSS.** The output must be a valid Next.js App Router page or component file that can be dropped into `apps/web/src/app/` or `apps/web/src/components/` without modification to the import paths.

### Workflow per screen

1. Review the screen's entry in Section 4 (purpose, data, actions, states).
2. Check Section 5 to see which components are available — reuse them.
3. Apply the visual direction from Section 2 and the tokens from Section 3.
4. Output: the page/component `.tsx` file, any new `en-GB.json` keys, and any new sub-components needed.
5. Review output against the reference screenshots before moving to the next screen.
