# Visual Flow Builder (Plan 4.5) — Design

Date: 2026-07-04
Status: Approved (direction delegated — "complete all of it")

## Why

Plan 4.5 (visual flow builder) is the biggest remaining table-stakes gap — every Group-B
competitor has a node canvas, and self-hosted panels rarely do. The chatbot already has a
rich keyword-trigger + action-chain engine; a visual canvas lets users *see and shape*
their automation at a glance instead of reading a list.

## Goal

A node canvas per chatbot showing the automation flow: an "Incoming message" root →
one node per keyword trigger (with its response/action summary) → terminal fallback
nodes (Claude AI reply, Autoresponder). Users can add a trigger, delete a trigger, and
click a trigger to open the existing full rule editor. Built on the existing engine — no
new runtime semantics.

## Scope (v1) and deferred

**In v1:** read canvas with auto-layout (pan/zoom), add-trigger (keyword + response),
delete-trigger, click-to-edit (deep-link to the rule editor). Reuses the existing
trigger CRUD APIs — the graph reflects live data, so the flow view and the list editor
stay in sync.

**Deferred (documented):** free-form node dragging with persisted positions; branching /
conditional edges; wait/delay nodes; drag-to-connect. These need new execution semantics
and are out of scope for this increment.

## Approach

- Add `@xyflow/react` (v12, React 19 compatible) to `apps/web`.
- Pure layout helper `buildFlowGraph(chatbot)` → `{ nodes, edges }` (unit-tested, no
  React): a root node, a trigger node per trigger (positioned in a column, summary text
  from keyword/matchType + response/action count), and terminal nodes for Claude
  fallback (when `fallbackProvider !== "none"`) and Autoresponder (when enabled), each
  wired root → trigger and trigger-column → fallbacks.
- Client component `FlowCanvas` renders the graph with `@xyflow/react`, a toolbar
  (Add trigger), and node interactions (click trigger → router.push to the rule editor
  anchored by triggerId; delete button on trigger nodes).
- Page `/[workspaceSlug]/automation/chatbot/[id]/flow` loads the chatbot + triggers +
  autoresponder-enabled flag and renders the canvas. A "Flow" tab is added to the
  chatbot editor nav.

## Error handling

- No chatbot yet → show a prompt to create one on the Rules tab (canvas hidden).
- Add/delete failures → inline toast; the canvas refetches to stay truthful.

## Testing

- `buildFlowGraph`: root always present; one node+edge per trigger; fallback node only
  when provider set; autoresponder node only when enabled; trigger summary reflects
  action count vs plain response.
