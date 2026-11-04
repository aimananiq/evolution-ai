# Chatbot Topics — reusable assistants with guardrails & knowledge

**Date:** 2026-07-18
**Status:** Design approved (Approach A), pending spec review

## Goal

Let non-technical staff build reusable chatbot "Topics" — each a self-contained
assistant with its own **persona, guardrails, and knowledge** — and attach any
topic to any WhatsApp number. Replaces today's model of one hand-configured bot
per number (single system prompt + whole-workspace knowledge).

Driving needs from the user:
1. **Topic library** — build once (Admissions, YLP, Fees…), reuse across numbers.
2. **Guardrails** — stop the bot embarrassing the college (no hallucination, stay on topic, hand off to humans).
3. **Knowledge feed** — easy multi-source feeding, with **efficiency/token guidance** so staff pick the cheap, precise options.
4. **Non-technical friendly** throughout.

## Core concepts

- **Topic** — a reusable assistant: `{ name, persona, guardrails, knowledge[] }`.
- **Assignment** — a WhatsApp number's chatbot points at one Topic (a dropdown). Swappable anytime. This is "choose which one to use."
- **Knowledge** — per-topic entries from mixed sources, chunked into retrievable snippets. The bot grounds replies in *that topic's* knowledge only.

Back-compat: a chatbot with **no topic assigned** behaves exactly as today
(its own `systemPrompt` + workspace-wide knowledge). Nothing existing breaks.

## Data model (Prisma)

New:
```
model ChatTopic {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  personaTone   String?      // "polite, BM + English, short"
  greeting      String?      // optional opener
  guardrails    Json         // see Guardrails below
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  workspace     Workspace @relation(...)
  snippets      KnowledgeSnippet[]
  @@unique([workspaceId, name])
  @@index([workspaceId])
}
```
Extend existing `KnowledgeSnippet` (already `title` + `content` + `enabled`):
```
+ topicId     String?   // null = legacy workspace-wide
+ sourceType  String    @default("faq")   // "faq" | "text" | "pdf" | "url"
+ sourceLabel String?   // groups chunks from one upload (delete-as-a-group)
+ @@index([topicId])
```
Extend `Chatbot`:
```
+ topicId     String?   // assigned topic; null = legacy behaviour
```
`guardrails` JSON shape:
```
{
  stayOnTopic: boolean,            // ① deflect off-topic
  answerOnlyFromKnowledge: boolean,// ② no hallucination (default ON)
  handoff: { enabled: boolean, triggers: string[], onUnsure: boolean }, // ③
  neverSay: string[],              // ④ don't-promise / don't-quote list
  fallbackMessage: string          // ⑥ exact wording when it can't help (default provided)
}
```
Tone/language ⑤ = `personaTone`.

## Guardrails — enforcement

Built into the system prompt the engine assembles per reply, plus behaviour:
- **② Answer only from knowledge (default ON):** prompt scaffolding — *"Answer ONLY from the KNOWLEDGE below. If the answer isn't there, reply exactly with the fallback message. Never guess fees, dates, or promises."* If retrieval returns nothing relevant → send fallback directly (skip the model).
- **⑥ Safe fallback:** the exact `fallbackMessage` (default: "Let me connect you with our team — please hold on. 🙏").
- **③ Human handoff:** if the inbound matches a `triggers` word (e.g. "talk to human", "complaint") OR the model signals low confidence/uses the fallback → apply human-takeover (reuse existing `detectAndApplyTakeover` in `ai-actions.ts`) + tag the conversation + pause the bot.
- **① Stay on topic:** prompt instruction to politely decline out-of-scope questions and point to the right channel.
- **④ Never say:** injected as hard "do not" rules.
- **⑤ Tone/language:** `personaTone` prepended to the system prompt.

## Knowledge feed (the "buffet with a nutrition label")

Sources (user chooses/combines any):
| Source | UI | Badge |
|---|---|---|
| **FAQ** (Q→A) | question + answer fields → 1 snippet | 🟢 most efficient & precise |
| **Paste text** | textarea → 1+ snippet(s) | 🟢 efficient |
| **Upload PDF/Word** | drop file → extracted + auto-chunked (~800 chars) into snippets sharing a `sourceLabel` | 🟡 convenient, can be token-heavy — trim to what customers ask |
| **Website URL** | fetch + extract (v2, optional) | 🟠 heaviest / least reliable |

- Each entry shows its size (chars → approx tokens).
- **Topic-level meter:** 🟢 Lean → 🟡 Getting large → 🔴 Very large, with the reminder that big knowledge costs more per reply and dilutes accuracy — prefer FAQ / trim PDFs.
- Note surfaced in UI: *the bot only retrieves the few most-relevant pieces per reply, so per-message cost stays bounded — the meter mainly guides quality + storage.*
- **Chunking + retrieval:** reuse existing `retrieveContext(query, snippets)` (`@evo/kb`), scoped to `snippets where topicId = topic.id`. PDF/Word extraction via a parser lib (e.g. `unpdf` / `mammoth`); chunk into ~800-char snippets.

## UI

- **Topics page** — `/[workspaceSlug]/automation/topics`: list of topics (name, #knowledge, #numbers using it) + **＋ New topic**.
- **Topic editor** — `/automation/topics/[id]`, tabbed:
  1. **Persona** — name, tone/language, greeting.
  2. **Guardrails** — checkboxes (defaults pre-ticked) + "Never say" list + fallback message + handoff triggers.
  3. **Knowledge** — source cards (FAQ builder, paste, upload) + per-entry size + topic meter.
  4. **Test** — "Try a message" box → shows the bot's answer **and which knowledge it used** (verify before going live).
- **Chatbot editor** (per number) — add **"Topic: [Admissions ▾]"** dropdown. When a topic is assigned, hide the raw system-prompt/model-override fields (they now come from the topic + workspace AI); the "AI fallback On/Off" + keyword rules stay.

## Engine changes

`apps/ingest/src/automate.ts`:
- If the chatbot has a `topicId`: load the topic; assemble the system prompt from `personaTone + guardrails + retrieved topic knowledge`; enforce ②/⑥ (fallback when no knowledge) and ③ (handoff triggers). Use the **chatbot AI scope** provider (already wired).
- If no `topicId`: unchanged (legacy path).

New APIs (all workspace-scoped, permission-gated):
- `topics` CRUD; `topics/[id]/knowledge` CRUD + PDF upload; assign topic on `chatbots`; `topics/[id]/test` (runs grounding + reply for a sample).

## Migration & compatibility

- Additive migration: new `ChatTopic` table + nullable `topicId` on `Chatbot` and `KnowledgeSnippet` + `sourceType`/`sourceLabel` on snippets.
- Existing chatbots (`topicId = null`) and existing snippets (`topicId = null`) keep working exactly as now.

## Out of scope (v1)

- **Auto-routing** (bot picks the topic itself) — revisit after A ships.
- **Website URL** source — optional v2.
- Analytics on topic performance.

## Open questions

- PDF parser choice (`unpdf` vs `pdf-parse`) + Word (`mammoth`) — pick during planning.
- Exact token thresholds for the meter (green/amber/red).
