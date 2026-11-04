# Knowledge Base Grounding — Design

Date: 2026-07-04
Status: Approved (direction delegated)

## Why

The chatbot Claude-fallback and the new inbox agent-assist both answer from only the
conversation + a hand-written system prompt. They can't cite the workspace's actual
business facts (hours, pricing, policies, product details). A per-workspace **knowledge
base** — short text snippets injected into the model's system prompt when relevant —
grounds both features in real information. This is the differentiator respond.io/WATI
charge for; doing it self-hosted with no external embedding dependency fits our
flat-cost positioning.

## Goal

Workspace admins add knowledge snippets (title + content). When the chatbot or
agent-assist drafts a reply, the most relevant enabled snippets are retrieved by keyword
match against the latest customer message and prepended to the system prompt.

## Non-goals (deferred, noted as upgrade path)

- Vector/embedding retrieval (pgvector). Keyword retrieval is enough for the modest KB
  sizes a single workspace maintains; `@evo/kb` isolates retrieval so a vector backend
  can replace it later without touching call sites.
- Document upload / chunking (snippets are authored directly in v1).
- Per-instance KB scoping (workspace-wide in v1).

## Approach

### `@evo/kb` package (pure, no I/O — testable)

```
retrieveContext(query, snippets, opts?) -> { used: KbSnippet[]; block: string }
```

- `KbSnippet = { id, title, content }`.
- Tokenise query and each snippet (lowercase, strip punctuation, drop 1–2 char tokens
  and a small stopword set). Score = matched query tokens, with title matches weighted
  higher than content matches.
- Return the top `limit` (default 3) snippets with score > 0, each content clamped to
  `maxCharsPerSnippet` (default 600). `block` is a formatted context string, or `""`
  when nothing matches (so callers inject nothing).
- Block format:
  > "Use the following business information when answering. If it does not cover the
  >  question, rely on general knowledge and do not invent specifics.\n\n- <title>:
  >  <content>\n- …"

### Data model (`packages/db`)

```prisma
model KnowledgeSnippet {
  id          String   @id @default(cuid())
  workspaceId String
  title       String
  content     String
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, enabled])
}
```
Registered in `TENANTED_MODELS`.

### Integration points

Both compose: `systemPrompt = base + "\n\n" + kbBlock` (when block non-empty), keeping
existing suffixes.

1. **Chatbot fallback** (`apps/ingest/src/automate.ts`): before `claudeReply`, load
   enabled snippets for the workspace, `retrieveContext(inboundText, …)`, prepend the
   block to `chatbot.systemPrompt ?? default`.
2. **Agent-assist** (`apps/web/.../suggest-reply/route.ts`): same, using the latest
   inbound message as the query. `buildSuggestRequest` gains an optional
   `knowledgeBlock` argument inserted between the base prompt and the reply-only suffix.

Query text = the most recent inbound message body (the customer's question); fall back
to the concatenation of recent inbound messages if the last one is empty.

### API + UI (`apps/web`)

- `GET/POST /api/workspaces/[slug]/knowledge` (list Agent+, create Admin).
- `PUT/DELETE /api/workspaces/[slug]/knowledge/[id]` (Admin), including an `enabled`
  toggle.
- Settings page `/[workspaceSlug]/settings/knowledge` with an add form and a
  list (edit content, enable/disable, delete). Linked from the Integrations hub.
- i18n block `knowledge`.

## Error handling

- KB load failure in either call site is swallowed (grounding is best-effort — a KB
  outage must never block a reply); the model still answers from conversation context.
- Empty/whitespace query → no retrieval, no injection.

## Testing

- `@evo/kb`: scoring/ranking, title weighting, limit + clamp, stopword handling,
  empty-query and no-match → empty block.
- `apps/web`: extend `suggest-reply` helper test for the injected knowledge block.
- Wiring in ingest/web is exercised via typecheck + existing suites (KB absent → block
  empty → behaviour unchanged, so existing tests stay green).
