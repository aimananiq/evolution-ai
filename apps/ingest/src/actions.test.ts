import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn(), mediaPayloadFromAsset: vi.fn() }));

const { prisma } = await import("@evo/db");
const { sendViaInstance, mediaPayloadFromAsset } = await import("@evo/send");
const { executeActions } = await import("./actions");
const mockedSend = vi.mocked(sendViaInstance);
const mockedMedia = vi.mocked(mediaPayloadFromAsset);

let workspaceId: string;
let instanceId: string;
let conversationId: string;
let contactId: string;

async function reset() {
  await prisma.botPendingState.deleteMany();
  await prisma.contactLabel.deleteMany();
  await prisma.contactListMember.deleteMany();
  await prisma.label.deleteMany();
  await prisma.contactList.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
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
    data: { workspaceId: ws.id, instanceId: inst.id, contactPhone: "60123", contactName: "Aisha" },
  });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123", name: "Aisha" } });
  workspaceId = ws.id; instanceId = inst.id; conversationId = conv.id; contactId = contact.id;
});

function ctx(over: Partial<Parameters<typeof executeActions>[0]> = {}) {
  return {
    workspaceId, instanceId, conversationId,
    contactPhone: "60123", contactName: "Aisha", contactId, inboundText: "blue",
    ...over,
  };
}

describe("executeActions", () => {
  it("send_text renders template vars and sends", async () => {
    await executeActions(ctx(), [{ type: "send_text", text: "Hi {{contact.name}}: {{response}}", presenceDelaySec: 0, mediaAssetId: null }]);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60123", text: "Hi Aisha: blue" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("send_text with mediaAssetId resolves and sends media with the text as caption", async () => {
    mockedMedia.mockResolvedValue({ type: "media", to: "60123", mediaUrl: "http://web/raw", mediatype: "image", caption: "Hi Aisha: blue", userId: null } as any);
    await executeActions(ctx(), [{ type: "send_text", text: "Hi {{contact.name}}: {{response}}", presenceDelaySec: 0, mediaAssetId: "asset-1" }]);
    expect(mockedMedia).toHaveBeenCalledWith("asset-1", workspaceId, "60123", "Hi Aisha: blue");
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ type: "media", caption: "Hi Aisha: blue" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("send_text falls back to text when the media asset is missing", async () => {
    mockedMedia.mockResolvedValue(null);
    await executeActions(ctx(), [{ type: "send_text", text: "Plain", presenceDelaySec: 0, mediaAssetId: "gone" }]);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ type: "text", text: "Plain" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("add_labels upserts ContactLabel rows", async () => {
    const lbl = await prisma.label.create({ data: { workspaceId, name: "VIP" } });
    await executeActions(ctx(), [{ type: "add_labels", labelIds: [lbl.id] }]);
    const links = await prisma.contactLabel.findMany({ where: { contactId } });
    expect(links).toHaveLength(1);
    expect(links[0]!.labelId).toBe(lbl.id);
  });

  it("remove_labels deletes the link", async () => {
    const lbl = await prisma.label.create({ data: { workspaceId, name: "VIP" } });
    await prisma.contactLabel.create({ data: { contactId, labelId: lbl.id } });
    await executeActions(ctx(), [{ type: "remove_labels", labelIds: [lbl.id] }]);
    expect(await prisma.contactLabel.count({ where: { contactId } })).toBe(0);
  });

  it("add_to_group upserts ContactListMember", async () => {
    const list = await prisma.contactList.create({ data: { workspaceId, name: "Leads" } });
    await executeActions(ctx(), [{ type: "add_to_group", listIds: [list.id] }]);
    expect(await prisma.contactListMember.count({ where: { contactId } })).toBe(1);
  });

  it("remove_from_group deletes membership", async () => {
    const list = await prisma.contactList.create({ data: { workspaceId, name: "Leads" } });
    await prisma.contactListMember.create({ data: { listId: list.id, contactId } });
    await executeActions(ctx(), [{ type: "remove_from_group", listIds: [list.id] }]);
    expect(await prisma.contactListMember.count({ where: { contactId } })).toBe(0);
  });

  it("forward_message sends to each number in 'all' mode", async () => {
    await executeActions(ctx(), [{ type: "forward_message", mode: "all", numbers: ["60999", "60888"] }]);
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999" }), expect.objectContaining({ origin: "chatbot" }));
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60888" }), expect.objectContaining({ origin: "chatbot" }));
  });

  it("rest_api calls fetch with templated body", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await executeActions(ctx(), [{ type: "rest_api", method: "POST", url: "https://example.com/hook", headers: {}, bodyTemplate: '{"from":"{{contact.phone}}"}' }]);
    expect(f).toHaveBeenCalledWith("https://example.com/hook", expect.objectContaining({ method: "POST", body: '{"from":"60123"}' }));
    f.mockRestore();
  });

  it("save_response parks a BotPendingState and returns true", async () => {
    const parked = await executeActions(ctx(), [{ type: "save_response", fieldKey: "favColour" }]);
    expect(parked).toBe(true);
    const state = await prisma.botPendingState.findUnique({ where: { conversationId } });
    expect(state?.kind).toBe("save_response");
    expect((state?.payload as any).fieldKey).toBe("favColour");
  });

  it("next_action parks a BotPendingState with the chained keyword", async () => {
    const parked = await executeActions(ctx(), [{ type: "next_action", keyword: "menu" }]);
    expect(parked).toBe(true);
    const state = await prisma.botPendingState.findUnique({ where: { conversationId } });
    expect(state?.kind).toBe("next_action");
    expect((state?.payload as any).keyword).toBe("menu");
  });

  it("forward_message rotator advances cursor across separate invocations via Redis", async () => {
    const { redis } = await import("@evo/queue");
    const triggerId = randomUUID();
    const action = { type: "forward_message" as const, mode: "rotator" as const, numbers: ["60999", "60888"] };

    // First call — should pick numbers[0] = "60999"
    vi.clearAllMocks();
    await executeActions(ctx({ triggerId }), [action]);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60999" }), expect.objectContaining({ origin: "chatbot" }));

    // Second call — should pick numbers[1] = "60888" (cursor persisted in Redis)
    vi.clearAllMocks();
    await executeActions(ctx({ triggerId }), [action]);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ to: "60888" }), expect.objectContaining({ origin: "chatbot" }));

    // Clean up Redis key
    await redis().del(`rotator:${triggerId}:0`);
  });
});
