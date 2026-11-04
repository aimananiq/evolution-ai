import { sendViaInstance, mediaPayloadFromAsset } from "@evo/send";
import { aiChat, resolveAiConfig, defaultModelFor, type AiProvider } from "@evo/ai";
import { retrieveContext, buildTopicSystemPrompt, shouldHandoff, type TopicGuardrails } from "@evo/kb";
import { parseActions } from "@evo/flow-actions";
import { executeActions, type ActionContext } from "./actions.js";
import {
  applyAutoLabel,
  detectAndApplyTakeover,
  enrolFollowUp,
  writeBotLog,
  type AutoLabelConfig,
  type HumanTakeoverConfig,
  type AutoFollowUpConfig,
} from "./ai-actions.js";
import { runAutoresponder } from "./autoresponder.js";

const RECENT_LIMIT = 6;

export interface AutomateInput {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string | null;
  inboundText: string;
}

export async function automate(input: AutomateInput): Promise<void> {
  const { prisma } = await import("@evo/db");

  // Determine if the JID represents a group (ends with @g.us).
  const isGroup = input.contactPhone.endsWith("@g.us");

  // Helper: try to run the autoresponder as a last-resort fallback.
  async function tryAutoresponder() {
    await runAutoresponder({
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      contactPhone: input.contactPhone,
      inboundText: input.inboundText,
      isGroup,
    });
  }

  // Load chatbot including aiActionConfig (Plan 9) and triggers (Plan 8)
  const chatbot = await prisma.chatbot.findUnique({
    where: { instanceId: input.instanceId },
    include: { triggers: true, aiActionConfig: true },
  });

  // No chatbot configured or disabled — autoresponder still gets a chance.
  if (!chatbot || !chatbot.enabled || chatbot.pauseBot) {
    await tryAutoresponder();
    return;
  }

  const text = input.inboundText.trim();
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: input.workspaceId, phoneE164: input.contactPhone } },
  });
  const baseCtx: ActionContext = {
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
    contactPhone: input.contactPhone,
    contactName: contact?.name ?? input.contactName ?? "",
    contactId: contact?.id ?? "",
    inboundText: text,
  };
  const actionCtx = {
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    conversationId: input.conversationId,
    contactPhone: input.contactPhone,
    inboundText: text,
  };

  // Step 1 (Plan 9): Auto-label always runs (even if the convo is later paused).
  if (chatbot.aiActionConfig) {
    await applyAutoLabel(actionCtx, chatbot.aiActionConfig.autoLabel as unknown as AutoLabelConfig);
  }

  // Step 2 (Plan 8): Resolve any parked pending state BEFORE keyword matching.
  const pending = await prisma.botPendingState.findUnique({ where: { conversationId: input.conversationId } });
  if (pending && pending.expiresAt > new Date()) {
    await prisma.botPendingState.delete({ where: { conversationId: input.conversationId } });
    if (pending.kind === "save_response") {
      const fieldKey = (pending.payload as any)?.fieldKey as string | undefined;
      if (fieldKey) {
        if (contact) {
          const current = (contact.customFields as Record<string, unknown> | null) ?? {};
          await prisma.contact.update({
            where: { id: contact.id },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { customFields: { ...current, [fieldKey]: text } as any },
          });
        } else {
          // No Contact row yet — upsert one so the captured value is never lost.
          const existing = await prisma.contact.findUnique({
            where: { workspaceId_phoneE164: { workspaceId: input.workspaceId, phoneE164: input.contactPhone } },
          });
          const current = (existing?.customFields as Record<string, unknown> | null) ?? {};
          await prisma.contact.upsert({
            where: { workspaceId_phoneE164: { workspaceId: input.workspaceId, phoneE164: input.contactPhone } },
            create: {
              workspaceId: input.workspaceId,
              phoneE164: input.contactPhone,
              name: input.contactName ?? null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              customFields: { [fieldKey]: text } as any,
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: { customFields: { ...current, [fieldKey]: text } as any },
          });
        }
      }
      // Pending state consumed the message — no autoresponder.
      return;
    }
    if (pending.kind === "next_action") {
      const keyword = (pending.payload as any)?.keyword as string | undefined;
      const chained = keyword
        ? chatbot.triggers.find((t) => keywordMatches(keyword, t.keyword, "exact"))
        : undefined;
      if (chained) {
        await executeActions({ ...baseCtx, triggerId: chained.id }, parseActions(chained.actions));
      }
      // Pending state consumed the message — no autoresponder.
      return;
    }
  } else if (pending) {
    // expired — clear and fall through to normal matching
    await prisma.botPendingState.delete({ where: { conversationId: input.conversationId } });
  }

  // Step 3 (Plan 9): If a human already took over this conversation, the bot stays silent.
  // Autoresponder also stays silent when a human is handling the conversation.
  const conv = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
  if (conv?.botPaused) return;

  // Step 4 (Plan 9): Human takeover detection — if it fires (and pauses), stop here.
  // No autoresponder when takeover fires (human is taking over).
  if (chatbot.aiActionConfig) {
    const tookOver = await detectAndApplyTakeover(actionCtx, chatbot.aiActionConfig.humanTakeover as unknown as HumanTakeoverConfig);
    if (tookOver) return;
  }

  // Step 5a: First-contact welcome. Detect by counting messages in this conversation.
  // A count of 1 means the just-persisted inbound is the only message — brand new contact.
  // Resolve the effective welcome: chatbot.welcomeMessage → topic.greeting → (none).
  // We load the topic below for the AI path; peek at topicId here before the topic query.
  const messageCount = await prisma.message.count({ where: { conversationId: input.conversationId } });
  if (messageCount === 1) {
    // Resolve topic greeting if needed (avoid double-loading; load now if topicId exists).
    let welcomeText: string | null = chatbot.welcomeMessage ?? null;
    if (!welcomeText && chatbot.topicId) {
      const topicForGreeting = await prisma.chatTopic.findFirst({
        where: { id: chatbot.topicId, workspaceId: input.workspaceId },
        select: { greeting: true },
      });
      welcomeText = topicForGreeting?.greeting ?? null;
    }
    if (welcomeText?.trim()) {
      await sendViaInstance(input.instanceId, {
        type: "text",
        to: input.contactPhone,
        text: welcomeText.trim(),
        userId: null,
      }, { origin: "chatbot" });
    }
  }

  // Track whether the bot replied (for enrolFollowUp lastSender determination)
  let repliedByBot = false;

  // Step 5b (Plan 8): Normal keyword matching → run the action chain (or legacy single response).
  const matched = chatbot.triggers.find((t) => keywordMatches(text, t.keyword, t.matchType));
  if (matched) {
    const actions = parseActions(matched.actions);
    if (actions.length > 0) {
      await executeActions({ ...baseCtx, triggerId: matched.id }, actions);
    } else {
      // Trigger media (Plan 7): send the asset with the response as caption; text fallback.
      const mediaPayload = matched.mediaAssetId
        ? await mediaPayloadFromAsset(matched.mediaAssetId, input.workspaceId, input.contactPhone, matched.response)
        : null;
      await sendViaInstance(
        input.instanceId,
        mediaPayload ?? { type: "text", to: input.contactPhone, text: matched.response, userId: null },
        { origin: "chatbot" },
      );
    }
    await writeBotLog(actionCtx, "trigger_matched", { keyword: matched.keyword });
    repliedByBot = true;
    // Enrol follow-up (lastSender = chatbot) and return — no autoresponder.
    if (chatbot.aiActionConfig) {
      const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
      await enrolFollowUp(actionCtx, chatbot.id, fu, "chatbot");
    }
    return;
  }

  // Step 6: AI fallback. Uses the workspace's configured AI provider
  // (Gemini / Ollama / Grok / Claude / OpenAI — set in Settings → Integrations → AI).
  // `fallbackProvider === "none"` disables the AI fallback for this bot.
  if (chatbot.fallbackProvider === "none") {
    if (chatbot.aiActionConfig) {
      const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
      await enrolFollowUp(actionCtx, chatbot.id, fu, "customer");
    }
    await tryAutoresponder();
    return;
  }

  const recent = await prisma.message.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { sentAt: "desc" },
    take: RECENT_LIMIT,
  });
  const context = recent.reverse().map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.body ?? "",
  }));

  const aiCfg = await resolveAiConfig(input.workspaceId, "chatbot");
  if (!aiCfg || (aiCfg.provider !== "ollama" && !aiCfg.apiKey)) {
    // AI fallback enabled but no usable AI config — fall back to autoresponder.
    if (chatbot.aiActionConfig) {
      const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
      await enrolFollowUp(actionCtx, chatbot.id, fu, "customer");
    }
    await tryAutoresponder();
    return;
  }

  // Topic-aware grounding (Task 8): if this bot is bound to a ChatTopic, apply its
  // persona + guardrails. A missing topic falls through to the legacy behaviour.
  const topic = chatbot.topicId
    ? await prisma.chatTopic.findFirst({ where: { id: chatbot.topicId, workspaceId: input.workspaceId } })
    : null;

  let systemPrompt: string;
  if (topic) {
    const guardrails = topic.guardrails as unknown as TopicGuardrails;

    // Guardrail ③ — Handoff BEFORE calling the model. Reuse the same human-takeover
    // mechanism as ai-actions: pause the bot on the conversation + log.
    if (shouldHandoff(text, guardrails)) {
      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { botPaused: true, botPausedReason: "human_takeover" },
      });
      if (guardrails.fallbackMessage?.trim()) {
        await sendViaInstance(input.instanceId, {
          type: "text",
          to: input.contactPhone,
          text: guardrails.fallbackMessage,
          userId: null,
        }, { origin: "chatbot" });
      }
      await writeBotLog(actionCtx, "human_takeover", { via: "topic_handoff", topicId: topic.id });
      return;
    }

    // Retrieve grounding from this topic's enabled snippets only.
    const snippets = await prisma.knowledgeSnippet.findMany({
      where: { topicId: topic.id, workspaceId: input.workspaceId, enabled: true },
      select: { id: true, title: true, content: true },
    });
    // `bare: true` so the grounding block carries no "rely on general knowledge"
    // preamble — that would contradict answerOnlyFromKnowledge.
    const { block } = retrieveContext(text, snippets, { bare: true });

    // Guardrails ② + ⑥ — Anti-hallucination. When we must answer only from
    // knowledge and there is no relevant knowledge, skip the model entirely.
    if (guardrails.answerOnlyFromKnowledge && !block?.trim()) {
      // Guardrail ③ — if handoff-on-unsure is enabled, pause the bot and hand
      // to a human (same mechanism as trigger-word handoff). Send the fallback
      // either way.
      if (guardrails.handoff?.enabled && guardrails.handoff?.onUnsure) {
        await prisma.conversation.update({
          where: { id: input.conversationId },
          data: { botPaused: true, botPausedReason: "human_takeover" },
        });
      }
      if (guardrails.fallbackMessage?.trim()) {
        await sendViaInstance(input.instanceId, {
          type: "text",
          to: input.contactPhone,
          text: guardrails.fallbackMessage,
          userId: null,
        }, { origin: "chatbot" });
      }
      if (guardrails.handoff?.enabled && guardrails.handoff?.onUnsure) {
        await writeBotLog(actionCtx, "human_takeover", { via: "topic_unsure", topicId: topic.id });
      } else {
        await writeBotLog(actionCtx, "ai_reply", { fellBack: true, topicId: topic.id, reason: "no_knowledge" });
      }
      return;
    }

    systemPrompt = buildTopicSystemPrompt({ personaTone: topic.personaTone, guardrails, knowledge: block });
  } else {
    // Legacy path — ground the reply in the workspace knowledge base (best-effort — never blocks).
    systemPrompt = chatbot.systemPrompt ?? "You are a helpful customer service assistant.";
    try {
      const snippets = await prisma.knowledgeSnippet.findMany({
        where: { workspaceId: input.workspaceId, enabled: true },
        select: { id: true, title: true, content: true },
        take: 100,
      });
      const { block } = retrieveContext(text, snippets);
      if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
    } catch {
      /* KB lookup failed — answer without grounding */
    }
  }

  let reply: string;
  try {
    reply = await aiChat({
      provider: aiCfg.provider as AiProvider,
      apiKey: aiCfg.apiKey,
      endpoint: aiCfg.endpoint,
      // Per-chatbot model override, else the workspace default, else provider default.
      model: chatbot.fallbackModel || aiCfg.model || defaultModelFor(aiCfg.provider as AiProvider),
      system: systemPrompt,
      messages: context.length ? context : [{ role: "user", content: text }],
      maxTokens: 1024,
    });
  } catch {
    // Claude failed — try autoresponder as lowest-priority fallback.
    if (chatbot.aiActionConfig) {
      const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
      await enrolFollowUp(actionCtx, chatbot.id, fu, "customer");
    }
    await tryAutoresponder();
    return;
  }
  if (!reply) {
    // Claude returned empty — try autoresponder as lowest-priority fallback.
    if (chatbot.aiActionConfig) {
      const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
      await enrolFollowUp(actionCtx, chatbot.id, fu, "customer");
    }
    await tryAutoresponder();
    return;
  }

  await sendViaInstance(input.instanceId, {
    type: "text",
    to: input.contactPhone,
    text: reply,
    userId: null,
  }, { origin: "chatbot" });
  await writeBotLog(actionCtx, "ai_reply", { model: chatbot.fallbackModel });
  repliedByBot = true;

  // Enrol follow-up (lastSender = chatbot since AI replied) — no autoresponder.
  if (chatbot.aiActionConfig) {
    const fu = chatbot.aiActionConfig.autoFollowUp as unknown as AutoFollowUpConfig;
    await enrolFollowUp(actionCtx, chatbot.id, fu, "chatbot");
  }
}

function keywordMatches(text: string, keyword: string, matchType: string): boolean {
  const t = text.toLowerCase();
  const k = keyword.toLowerCase();
  if (matchType === "exact") return t === k;
  if (matchType === "startsWith") return t.startsWith(k);
  return t.includes(k);
}
