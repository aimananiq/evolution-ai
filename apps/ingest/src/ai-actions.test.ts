import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn() }));

const { prisma } = await import("@evo/db");
const { applyAutoLabel, detectAndApplyTakeover, enrolFollowUp } = await import("./ai-actions");
const { sendViaInstance } = await import("@evo/send");
const mockedSend = vi.mocked(sendViaInstance);

let workspaceId: string, instanceId: string, conversationId: string, contactId: string, labelId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.botUserLog.deleteMany();
  await prisma.dripEnrolment.deleteMany();
  await prisma.dripCampaign.deleteMany();
  await prisma.contactLabel.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.label.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e-" + Date.now(), evolutionApiKey: "K" } });
  const conv = await prisma.conversation.create({ data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123" } });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123" } });
  const label = await prisma.label.create({ data: { workspaceId: ws.id, name: "VIP" } });
  workspaceId = ws.id; instanceId = inst.id; conversationId = conv.id; contactId = contact.id; labelId = label.id;
});

describe("applyAutoLabel", () => {
  it("adds a label when the rule matches and logs it", async () => {
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I want a REFUND please" },
      { enabled: true, rules: [{ contains: "refund", labelId, op: "add" }] },
    );
    const links = await prisma.contactLabel.findMany({ where: { contactId } });
    expect(links).toHaveLength(1);
    const log = await prisma.botUserLog.findFirst({ where: { kind: "auto_label" } });
    expect(log).not.toBeNull();
  });

  it("does nothing when disabled", async () => {
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "refund" },
      { enabled: false, rules: [{ contains: "refund", labelId, op: "add" }] },
    );
    expect(await prisma.contactLabel.count()).toBe(0);
  });

  it("removes a label with op=remove", async () => {
    await prisma.contactLabel.create({ data: { contactId, labelId } });
    await applyAutoLabel(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "thanks resolved" },
      { enabled: true, rules: [{ contains: "resolved", labelId, op: "remove" }] },
    );
    expect(await prisma.contactLabel.count()).toBe(0);
  });
});

describe("detectAndApplyTakeover", () => {
  const cfg = {
    enabled: true,
    triggerKeywords: ["agent", "human"],
    notifyType: "whatsapp_number" as const,
    notifyTargets: ["60999"],
    agentMessageTemplate: "Takeover for {{user_phone}}",
    disableBotOnTakeover: true,
    userMessage: "Connecting you to a human.",
  };

  it("pauses the conversation, notifies agent, messages user and logs", async () => {
    const fired = await detectAndApplyTakeover(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "I need an agent now" },
      cfg,
    );
    expect(fired).toBe(true);
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.botPaused).toBe(true);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999", text: "Takeover for 60123" }), expect.objectContaining({ origin: "chatbot" }));
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60123", text: "Connecting you to a human." }), expect.objectContaining({ origin: "chatbot" }));
    expect(await prisma.botUserLog.count({ where: { kind: "human_takeover" } })).toBe(1);
  });

  it("returns false when no keyword matches", async () => {
    const fired = await detectAndApplyTakeover(
      { workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "what is the price" },
      cfg,
    );
    expect(fired).toBe(false);
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv?.botPaused).toBe(false);
  });
});

describe("enrolFollowUp", () => {
  const cfg = {
    enabled: true, lastSenderFilter: "customer" as const,
    conditions: { contactGroupIds: [], labelIds: [] },
    steps: [{ text: "Still there?", delaySeconds: 3600 }],
  };
  it("enrols when last sender matches the filter", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const ok = await enrolFollowUp({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "" }, cb.id, cfg, "customer");
    expect(ok).toBe(true);
    expect(await prisma.dripEnrolment.count()).toBe(1);
  });
  it("skips when lastSender does not match", async () => {
    const cb = await prisma.chatbot.create({ data: { workspaceId, instanceId, enabled: true, fallbackProvider: "none" } });
    const ok = await enrolFollowUp({ workspaceId, instanceId, conversationId, contactPhone: "60123", inboundText: "" }, cb.id, cfg, "chatbot");
    expect(ok).toBe(false);
  });
});
