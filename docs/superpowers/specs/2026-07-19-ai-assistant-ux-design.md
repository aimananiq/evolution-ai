# AI Assistant UX — Design Spec

**Date:** 2026-07-19
**Status:** Approved (brainstorming) — ready for implementation planning
**Author:** dev@innovative.edu.my + Claude

## Goal

Make the chatbot the most usable feature for **non-technical tenants** by replacing the current
Topic + Chatbot split (and its jargon) with a single, guided **"AI Assistant"** experience that
*cannot end in a half-configured, silent state*.

## Why (the problem)

The current chatbot setup has four traps for non-technical users, observed live:

1. **The silent-failure trap.** Assigning a Topic does nothing unless a *separate* "AI fallback"
   dropdown is also switched from "Off" to "On". A tenant (YLP) assigned a topic, left AI fallback
   off, and the bot never used it — with no indication why. This is the #1 issue.
2. **Two disconnected concepts** — "Topic" (reusable brain) and "Chatbot" (attached to a number) —
   that must be created and linked separately.
3. **Jargon** — "provider", "model override", "system prompt", "fallback", "presence delay",
   "tokens", "guardrails".
4. **Keyword rules front-and-center** even though they're optional, competing with the AI for attention.

## Approach (chosen)

- **AI Assistant-first.** Setting up a chatbot = create an *Assistant* (a brain) and turn it **On**
  for a number. AI answering is the default, not an opt-in.
- **One concept in the UI.** The tenant sees and manages one thing: an **Assistant**. Keyword auto-
  replies become an optional, collapsed **"Advanced → Quick replies"** section.
- **Hybrid layout.** A short first-run **wizard** (can't get lost), then a simple per-assistant
  **home screen** for day-to-day editing + testing.
- **No backend model changes required.** The existing `ChatTopic`, `Chatbot`, `KnowledgeSnippet`,
  and `WorkspaceAiKey` models already support this. This is primarily a UX/orchestration layer plus
  one behavioural fix (atomic "turn on").
- **Theme-aware.** Every new screen uses the app's CSS theme tokens (`hsl(var(--…))`), so it follows
  the user's chosen **dark or light** theme. No hardcoded colors.

## Concept → data model mapping

The UI concept "Assistant" maps onto existing models; **no schema migration**:

| UI concept | Backed by |
|---|---|
| **Assistant** (name, voice, knowledge, safety) | a `ChatTopic` (`personaTone`, `guardrails`, `greeting`) + its `KnowledgeSnippet`s (`topicId`) |
| **"On for a number"** | the `Chatbot` row for that instance with `topicId` = this topic, `enabled = true`, `fallbackProvider != none` |
| **Draft** (not on a number) | a `ChatTopic` with no enabled `Chatbot` referencing it |
| **"Use on another number"** | another `Chatbot` row (different `instanceId`) pointing at the same `topicId` |
| **Quick replies** (Advanced) | that instance's `Chatbot.triggers` (`KeywordTrigger`) |
| **Legacy keyword-only chatbot** (no topic) | shown as an Assistant with "no brain yet"; adding knowledge creates a `ChatTopic` and links it |

### The core behavioural fix — atomic "Turn on"

Today, enabling requires two independent settings. The redesign makes **one action** ("Turn on for
this number") set, in a single transaction:

- `Chatbot.enabled = true`
- `Chatbot.topicId = <assistant's topic>`
- `Chatbot.fallbackProvider = <any non-"none" value>` (the on-flag; actual provider is resolved from
  the workspace `chatbot` AI scope, e.g. Ollama)

Turning **Off** sets `enabled = false`. There is no separate user-facing "AI fallback" control — it
is implied by having an Assistant with a brain. (The `fallbackProvider` enum value stored is an
internal on/off flag; the real model comes from `resolveAiConfig(workspaceId, "chatbot")`.)

## Screens

### 1. First-run wizard (4 steps)

Launched by **"+ New Assistant"**. One decision per step; safe defaults pre-filled so a tenant can
click through. Steps:

1. **Personality** — `Name`; `How should it sound?` = **Friendly / Professional / Playful** presets
   (each maps to a `personaTone` string); optional `First message` (maps to `ChatTopic.greeting`,
   sent as the chatbot `welcomeMessage`).
2. **What should it know?** — add knowledge via **Upload PDF/Word**, **Paste text**, or **Add Q&A**
   (existing `topics/[id]/knowledge` + `knowledge/upload` endpoints). A plain **"Knowledge size:
   Small — fast & low cost"** meter (re-labels the existing token meter: green→"Small", amber→
   "Medium", red→"Large — slower & pricier"). Two **pre-ticked** plain-language toggles:
   - "Only answer using this knowledge (don't make things up)" → `guardrails.answerOnlyFromKnowledge`
   - "Hand over to a human when it can't help" → `guardrails.handoff.enabled` + `handoff.onUnsure`,
     with an editable hand-off message (`guardrails.fallbackMessage`).
3. **Try it** — a live test chat using the existing `topics/[id]/test` endpoint, with 2–3 suggested
   questions. Lets the tenant validate before going live.
4. **Go live** — pick a **connected** WhatsApp number (instances with `connectionState = open`), then
   one **"Turn on"** button performs the atomic operation above. Confirmation shows the bot is live.

A tenant may finish at step 3 and leave the assistant as a **draft** (skip "Go live").

### 2. Assistant home screen

The landing screen for one assistant (and the day-to-day editor). Sections:

- **Hero** — avatar, name, live-status ("Live on iPhone 11 · answering with AI" / "Draft"), and a
  prominent **On/Off** switch (the atomic turn-on/off).
- **Personality** card (voice + first message) → Edit.
- **Knowledge** card — lists sources with the plain size note; **"Add knowledge."**
- **Try it** — inline test chat, always available.
- **Advanced** (collapsed `<details>`) — **Quick replies** (the existing keyword-trigger editor,
  re-labelled and de-emphasised), plus guardrail fine-tuning (only-from-knowledge, hand-off,
  "words it should never say" → `guardrails.neverSay`, length, typing delay → `presenceDelaySec`).
- **"Use on another number →"** — creates/links a `Chatbot` on another instance to this topic.

### 3. Navigation + list page

- A single **"AI Assistants"** nav item in the **Automation** group, **replacing** both the current
  "Chatbot Topics" entry and the per-instance "Chatbot" screen.
- The list page shows all assistants as cards: name, status pill (green "Live on <number>" / grey
  "Draft"), knowledge count, voice, an inline On/Off switch, and **Edit / Try it**. **"+ New
  Assistant"** launches the wizard.

## Migration (no data loss)

Existing data already maps to the new concepts, so migration is presentation + light backfill:

- A `ChatTopic` linked to an enabled `Chatbot` (e.g. **YLP** on iphone 11) → an Assistant that is
  **On**, unchanged.
- A `ChatTopic` with no enabled chatbot → a **draft** Assistant.
- A `Chatbot` with keyword triggers and **no** `topicId` → an Assistant card labelled "quick replies
  only / no brain yet", with a nudge to add knowledge (which creates and links a `ChatTopic`).
- A one-time **banner** on the list page: "We turned your existing setup into Assistants — nothing
  lost. Live ones stay live; drafts are off until you switch them on."
- **Back-compat:** existing API routes (`/topics`, `/chatbots`, keyword triggers, knowledge) remain;
  the new UI orchestrates them. The old chatbot editor route can redirect into the assistant home.

## Plain-language mapping (no jargon in the UI)

| Technical (today) | Non-technical UI label | Default |
|---|---|---|
| `fallbackProvider != none` + `enabled` | the **On/Off** switch / "Turn on" | on when going live |
| `ChatTopic.personaTone` | "How should it sound?" (Friendly/Professional/Playful) | Friendly |
| `ChatTopic.greeting` / `welcomeMessage` | "First message" | empty |
| `KnowledgeSnippet`s | "What it knows" / "Knowledge" | — |
| token meter (green/amber/red) | "Knowledge size: Small / Medium / Large" | — |
| `guardrails.answerOnlyFromKnowledge` | "Only answer from this knowledge" | **on** |
| `guardrails.handoff.enabled/onUnsure` + `fallbackMessage` | "Hand over to a human when it can't help" (+ message) | **on** |
| `guardrails.neverSay` | "Words it should never say" | empty |
| `presenceDelaySec` | "Typing delay" (Advanced) | 0 |
| `KeywordTrigger`s | "Quick replies" (Advanced) | none |
| provider / model override / system prompt | **removed from the UI** (workspace AI scope handles it) | — |

## Scope

**In scope:** the wizard, assistant home, assistants list + nav change, the atomic turn-on fix,
plain-language relabelling, theme-token compliance, migration presentation.

**Out of scope (YAGNI):** changing the AI engine/guardrail logic; new schema; multi-language content;
billing/quota UI; editing the workspace AI provider (stays in Settings → Integrations → AI, but is no
longer surfaced during assistant setup).

## Testing

- **Unit:** the atomic turn-on/off orchestration (sets enabled + topicId + fallbackProvider together;
  off sets enabled=false); the token-meter→size relabel; personaTone/guardrail mapping from wizard.
- **Component:** wizard step validation; assistant-home renders live vs draft; theme tokens (no
  hardcoded colors — assert computed styles switch with `.light`).
- **E2E (Playwright):** create assistant via wizard → add knowledge → test → turn on for a connected
  instance → assert `Chatbot` row has `enabled=true`, `topicId` set, `fallbackProvider != none`;
  toggle Off; verify migration presents an existing topic+chatbot as a live assistant.

## Success criteria

A non-technical tenant can create a working, replying WhatsApp assistant end-to-end without
encountering any technical term, and **cannot** finish in a state where it silently doesn't reply.
