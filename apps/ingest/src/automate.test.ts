import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
  mediaPayloadFromAsset: vi.fn().mockResolvedValue(null),
}));

vi.mock("@evo/ai", () => ({
  claudeReply: vi.fn(),
}));

const { prisma } = await import("@evo/db");
const { sendViaInstance, mediaPayloadFromAsset } = await import("@evo/send");
const { claudeReply } = await import("@evo/ai");
const { automate } = await import("./automate");

const mockedSend = vi.mocked(sendViaInstance);
const mockedMedia = vi.mocked(mediaPayloadFromAsset);
const mockedAi = vi.mocked(claudeReply);

let workspaceId: string;
let instanceId: string;
let conversationId: string;
let chatbotId: string;

async function reset() {
  await prisma.botUserLog.deleteMany();
  await prisma.aiActionConfig.deleteMany();
  await prisma.botPendingState.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.keywordTrigger.deleteMany();
  await prisma.chatbot.deleteMany();
  await prisma.knowledgeSnippet.deleteMany();
  await prisma.chatTopic.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const conv = await prisma.conversation.create({
    data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123", contactName: "A" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
  conversationId = conv.id;
});

describe("automate", () => {
  it("does nothing when no chatbot configured for the instance", async () => {
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedAi).not.toHaveBeenCalled();
  });

  it("sends keyword response when an exact keyword matches", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    chatbotId = cb.id;
    await prisma.keywordTrigger.create({
      data: { chatbotId, keyword: "hello", matchType: "exact", response: "Hi back!" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hello" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hi back!", to: "60123" }), expect.objectContaining({ origin: "chatbot" }));
    expect(mockedAi).not.toHaveBeenCalled();
  });

  it("sends a trigger's media asset with the response as caption", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "brochure", matchType: "exact", response: "Here you go", mediaAssetId: "asset-1" },
    });
    mockedMedia.mockResolvedValueOnce({ type: "media", to: "60123", mediaUrl: "http://web/raw", mediatype: "document", caption: "Here you go", userId: null } as any);
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "brochure" });
    expect(mockedMedia).toHaveBeenCalledWith("asset-1", workspaceId, "60123", "Here you go");
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ type: "media", caption: "Here you go" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("matches 'contains' keyword case-insensitively", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "Price", matchType: "contains", response: "RM10" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "what is the price?" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "RM10" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("falls back to Claude when no keyword matches and provider=claude", async () => {
    const cb = await prisma.chatbot.create({
      data: {
        workspaceId, instanceId, enabled: true,
        fallbackProvider: "claude", fallbackModel: "claude-haiku-4-5-20251001",
        systemPrompt: "Be brief.",
      },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "stock", matchType: "contains", response: "in stock" },
    });
    mockedAi.mockResolvedValue("Hello human.");
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedAi).toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hello human." }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("does NOT call AI when fallbackProvider=none and no keyword matches", async () => {
    const cb = await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" },
    });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "stock", matchType: "contains", response: "in stock" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedAi).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("does nothing when chatbot.enabled = false", async () => {
    await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: false, fallbackProvider: "claude", fallbackModel: "claude-haiku-4-5-20251001" },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedAi).not.toHaveBeenCalled();
  });

  it("runs the action chain instead of single response when actions are present", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "hi", matchType: "exact", response: "legacy",
        actions: [{ type: "send_text", text: "Hi {{contact.name}}", presenceDelaySec: 0, mediaAssetId: null }] },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Hi Aisha" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("save_response: next inbound is stored into Contact.customFields, no keyword match", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const contact = await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({ data: { chatbotId: cb.id, keyword: "z", matchType: "exact", response: "x" } });
    await prisma.botPendingState.create({
      data: { workspaceId, conversationId, contactPhone: "60123", kind: "save_response",
        payload: { fieldKey: "favColour" }, expiresAt: new Date(Date.now() + 60000) },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "blue" });
    const updated = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect((updated?.customFields as any).favColour).toBe("blue");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(await prisma.botPendingState.count({ where: { conversationId } })).toBe(0);
  });

  it("next_action: next inbound is routed to the chained rule's actions", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.contact.create({ data: { workspaceId, phoneE164: "60123", name: "Aisha" } });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "menu", matchType: "exact", response: "x",
        actions: [{ type: "send_text", text: "Here is the menu", presenceDelaySec: 0, mediaAssetId: null }] },
    });
    await prisma.botPendingState.create({
      data: { workspaceId, conversationId, contactPhone: "60123", kind: "next_action",
        payload: { keyword: "menu" }, expiresAt: new Date(Date.now() + 60000) },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "anything" });
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "Here is the menu" }), expect.objectContaining({ origin: "chatbot" }));
    expect(await prisma.botPendingState.count({ where: { conversationId } })).toBe(0);
  });

  it("does NOT reply when conversation.botPaused is true", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.keywordTrigger.create({ data: { chatbotId: cb.id, keyword: "hello", matchType: "exact", response: "Hi!" } });
    await prisma.conversation.update({ where: { id: conversationId }, data: { botPaused: true } });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hello" });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("takeover keyword pauses the bot and notifies the agent", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.aiActionConfig.create({
      data: {
        workspaceId, chatbotId: cb.id,
        autoLabel: { enabled: false, rules: [] },
        humanTakeover: {
          enabled: true, triggerKeywords: ["agent"], notifyType: "whatsapp_number",
          notifyTargets: ["60999"], agentMessageTemplate: "Help {{user_phone}}",
          disableBotOnTakeover: true, userMessage: "One moment.",
        },
        autoFollowUp: { enabled: false, steps: [] },
      },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "get me an agent" });
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.botPaused).toBe(true);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("sends topic greeting as welcome when chatbot has no welcomeMessage and it is first contact", async () => {
    const topic = await prisma.chatTopic.create({
      data: {
        workspaceId,
        name: "Support-" + Date.now(),
        greeting: "Hello! How can I help you today?",
        guardrails: {},
      },
    });
    await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none", topicId: topic.id },
    });
    // Simulate first contact: one inbound message (just persisted before automate is called).
    await prisma.message.create({
      data: {
        workspaceId,
        conversationId,
        direction: "inbound",
        evolutionMessageId: "ev-first-" + Date.now(),
        type: "text",
        body: "hi",
        sentAt: new Date(),
      },
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).toHaveBeenCalledWith(
      instanceId,
      expect.objectContaining({ text: "Hello! How can I help you today?", to: "60123" }),
      expect.objectContaining({ origin: "chatbot" }),
    );
  });

  it("does NOT send a welcome on second contact (messageCount > 1)", async () => {
    const topic = await prisma.chatTopic.create({
      data: {
        workspaceId,
        name: "Support2-" + Date.now(),
        greeting: "Hello! How can I help you today?",
        guardrails: {},
      },
    });
    await prisma.chatbot.create({
      data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none", topicId: topic.id },
    });
    // Two messages already in the conversation — not first contact.
    await prisma.message.createMany({
      data: [
        { workspaceId, conversationId, direction: "inbound", evolutionMessageId: "ev-a-" + Date.now(), type: "text", body: "first", sentAt: new Date() },
        { workspaceId, conversationId, direction: "outbound", evolutionMessageId: "ev-b-" + Date.now(), type: "text", body: "reply", sentAt: new Date() },
      ],
    });
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "second" });
    // sendViaInstance must NOT have been called with the greeting.
    const greetingCalls = mockedSend.mock.calls.filter(([, payload]) =>
      (payload as any).text === "Hello! How can I help you today?"
    );
    expect(greetingCalls).toHaveLength(0);
  });

  it("e2e: takeover keyword pauses bot, notifies agent, and bot stops replying on follow-up", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    await prisma.keywordTrigger.create({
      data: { chatbotId: cb.id, keyword: "hi", matchType: "exact", response: "Hello!" },
    });
    await prisma.aiActionConfig.create({
      data: {
        workspaceId, chatbotId: cb.id,
        autoLabel: { enabled: false, rules: [] },
        humanTakeover: {
          enabled: true, triggerKeywords: ["agent"], notifyType: "whatsapp_number",
          notifyTargets: ["60999"], agentMessageTemplate: "Help {{user_phone}}",
          disableBotOnTakeover: true, userMessage: "One sec.",
        },
        autoFollowUp: { enabled: false, steps: [] },
      },
    });

    // 1. customer asks for agent → takeover fires
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I want an agent" });
    const conv1 = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv1?.botPaused).toBe(true);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999", text: "Help 60123" }), expect.objectContaining({ origin: "chatbot" }));
    expect(await prisma.botUserLog.count({ where: { kind: "human_takeover" } })).toBe(1);

    // 2. follow-up "hi" (would normally trigger keyword → "Hello!") must NOT reply because botPaused
    mockedSend.mockClear();
    await automate({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "hi" });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("save_response: upserts a Contact when no Contact row exists so the captured value is not lost", async () => {
    await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    // No Contact row for phone "60777"
    const phone = "60777";
    const convNoContact = await prisma.conversation.create({
      data: { workspaceId, instanceId, contactPhone: phone, contactName: "Unknown" },
    });
    await prisma.botPendingState.create({
      data: {
        workspaceId, conversationId: convNoContact.id, contactPhone: phone,
        kind: "save_response", payload: { fieldKey: "favColour" },
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await automate({ workspaceId, instanceId, conversationId: convNoContact.id, contactPhone: phone, contactName: "Unknown", inboundText: "green" });
    const created = await prisma.contact.findUnique({
      where: { workspaceId_phoneE164: { workspaceId, phoneE164: phone } },
    });
    expect(created).not.toBeNull();
    expect((created?.customFields as any).favColour).toBe("green");
    expect(await prisma.botPendingState.count({ where: { conversationId: convNoContact.id } })).toBe(0);
  });
});
