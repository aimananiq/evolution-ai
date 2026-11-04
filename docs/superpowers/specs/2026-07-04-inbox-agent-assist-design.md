# Inbox AI Agent-Assist ("Suggest reply") — Design

Date: 2026-07-04
Status: Approved (direction delegated)

## Why

respond.io and other leaders gate AI agent-assist (drafted replies for human agents)
behind $159+/mo tiers; no self-hosted Evolution/Baileys panel offers it. We already
have `@evo/ai.claudeReply`, per-workspace AI keys, the chatbot's system prompt, and the
full conversation history — everything needed to draft a reply an agent can edit and
send. This is the highest-differentiation feature we can ship on existing infrastructure.

## Goal

In the inbox, an agent viewing a conversation clicks **Suggest reply**. Claude drafts a
reply grounded in the recent conversation and the instance's chatbot system prompt. The
draft fills the composer; the agent edits and sends as normal. Nothing is sent
automatically.

## Non-goals (deferred)

- A knowledge base / RAG (the chatbot system prompt already carries business context;
  KB is a larger follow-up).
- Streaming the draft token-by-token (one-shot response is fine for a short reply).
- Tone/length controls (v1 uses one sensible prompt).

## Approach

A single API route + a button in the existing reply composer. Reuse `@evo/ai.claudeReply`
and the existing `resolveAiKey` helper.

### API — `POST /api/workspaces/[slug]/conversations/[id]/suggest-reply`

- `requireMember(slug, "Agent")` (same level as sending).
- Load the conversation (tenant-scoped); 404 if missing.
- Load the instance's `Chatbot` (via `conversation.instanceId`) for `systemPrompt` and
  `fallbackModel` (both optional).
- Load the last 12 messages ordered by `sentAt`, map `inbound → user`, `outbound →
  assistant`, drop empty bodies. If the last message is not from the customer, still
  draft (agent may want a follow-up); if there are zero messages, return 422
  `NO_CONTEXT`.
- Resolve the Claude key via `resolveAiKey(workspaceId, "claude")`; if none, return 400
  `NO_AI_KEY` so the UI can point the user to settings.
- Model selection (first non-null): `chatbot.fallbackModel` → workspace AI key
  `defaultModel` → `DEFAULT_SUGGEST_MODEL = "claude-haiku-4-5"` (matches the app's
  documented default; honoring configured models first respects the user's own choice).
  Model ids verified against the claude-api skill.
- System prompt: `chatbot.systemPrompt` if set, else a default:
  > "You are a customer-support agent drafting a reply on WhatsApp for the business.
  >  Write a single, ready-to-send reply in the customer's language. Be concise,
  >  friendly, and professional. Do not add preamble, quotes, or explanations — output
  >  only the message text."
  A short instruction is appended in both cases to enforce "reply only, no preamble."
- Call `claudeReply({ model, systemPrompt, messages, maxTokens: 400, apiKey })`.
- Return `{ suggestion }`. On upstream error return 502 `AI_ERROR`.

### UI — reply composer (`reply-box.tsx`)

Add a **Suggest reply** button (sparkles icon) beside Send. On click: call the route,
show a loading state, then place the returned text in the composer for the agent to edit.
Errors map to friendly toasts (no AI key configured / generation failed). The button is
disabled while a request is in flight and while sending.

### i18n

Add to the `inbox` block: `suggest`, `suggesting`, `suggestNoKey`, `suggestFailed`,
`suggestNoContext`.

## Error handling

- No AI key → 400 `NO_AI_KEY` → toast directing to Settings → Integrations → AI.
- No messages → 422 `NO_CONTEXT` → toast "No conversation to draft from yet."
- Claude/network error → 502 `AI_ERROR` → toast "Couldn't generate a suggestion."
- All failures leave the composer untouched.

## Testing

- Unit-test the pure prompt/model-selection helper (`buildSuggestRequest`) in a small
  module: message mapping, model fallback order, system-prompt fallback, empty-context
  signalling. Keep the route thin around it so the logic is testable without HTTP.
