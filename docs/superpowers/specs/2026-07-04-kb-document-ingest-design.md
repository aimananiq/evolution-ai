# Knowledge Base Document Ingest — Design

Date: 2026-07-04
Status: Approved (direction delegated — "complete all of it")

## Why

The knowledge base currently requires authoring snippets one at a time. Businesses have
existing FAQs/policies as documents. Auto-chunking pasted document text into snippets
makes onboarding a KB a 30-second task and directly feeds the grounding pipeline already
wired into the chatbot and agent-assist.

## Goal

Admin pastes document text (markdown or plain) on the Knowledge base page and clicks
Import; it is split into well-sized snippets and saved. No external parsing service.

## Non-goals (deferred)

- Binary parsing (PDF/DOCX) — text/markdown paste only in v1 (heavy parsers are a
  separate dependency decision).
- Embeddings/semantic chunking — keyword retrieval already consumes the snippets.

## Approach

### `@evo/kb` — pure chunker (unit-tested)

```
chunkDocument(text, opts?) -> { title, content }[]
```
- If the text contains markdown headings (`#`..`######`), each heading starts a chunk:
  title = heading text, content = the lines until the next heading. Preamble before the
  first heading becomes a chunk titled from `opts.baseTitle` (default "Untitled").
- If there are no headings, split into paragraphs (blank-line separated) and pack them
  into chunks up to `maxChars` (default 800), titled `"<baseTitle> (n)"`.
- Any heading chunk whose content exceeds `maxChars` is further packed the same way,
  keeping the heading title (suffixed `(n)` for overflow parts).
- Trim; drop empty chunks; clamp a title to 120 chars. Cap total chunks at
  `opts.maxChunks` (default 200) and report truncation to the caller.

### API — `POST /api/workspaces/[slug]/knowledge/import` (Admin)

Body `{ baseTitle?: string, text: string }` (text ≤ 100k chars). Runs `chunkDocument`,
`createMany` KnowledgeSnippet rows (enabled), returns `{ created, truncated }`.

### UI

An "Import from document" panel on the Knowledge base page: base-title input, a textarea,
and an Import button. On success it shows the count and refreshes the list.

## Error handling

- Empty/whitespace text → 400 `EMPTY`.
- Over the char limit → 400 `TOO_LARGE`.
- Zero chunks produced (e.g. only whitespace/headings) → 400 `EMPTY`.

## Testing

- `@evo/kb.chunkDocument`: heading split, paragraph packing, oversized-chunk repacking,
  preamble handling, empty input, maxChunks truncation, title clamping.
