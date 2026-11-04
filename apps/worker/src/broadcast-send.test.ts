import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
  mediaPayloadFromAsset: vi.fn(),
  RampCapError: class RampCapError extends Error {},
}));

const { prisma } = await import("@evo/db");
const { sendViaInstance, mediaPayloadFromAsset } = await import("@evo/send");
const { broadcastSendProcessor } = await import("./broadcast-send");

const mockedSend = vi.mocked(sendViaInstance);

let workspaceId: string;
let instanceId: string;
let listId: string;
let templateId: string;
let broadcastId: string;
let targetIdSuccess: string;
let targetIdFail: string;

async function reset() {
  await prisma.broadcastTarget.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.contactListMember.deleteMany();
  await prisma.contactList.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const c1 = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "601" } });
  const c2 = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "602" } });
  const list = await prisma.contactList.create({ data: { workspaceId: ws.id, name: "L" } });
  await prisma.contactListMember.create({ data: { listId: list.id, contactId: c1.id } });
  await prisma.contactListMember.create({ data: { listId: list.id, contactId: c2.id } });
  const tpl = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "T", body: "hello" } });
  const b = await prisma.broadcast.create({
    data: {
      workspaceId: ws.id, instanceId: inst.id, listId: list.id, templateId: tpl.id,
      name: "B1", status: "running", createdByUserId: "user-x",
    } as any,
  });
  const t1 = await prisma.broadcastTarget.create({
    data: { workspaceId: ws.id, broadcastId: b.id, contactId: c1.id, status: "sending" },
  });
  const t2 = await prisma.broadcastTarget.create({
    data: { workspaceId: ws.id, broadcastId: b.id, contactId: c2.id, status: "sending" },
  });
  workspaceId = ws.id; instanceId = inst.id; listId = list.id; templateId = tpl.id;
  broadcastId = b.id; targetIdSuccess = t1.id; targetIdFail = t2.id;
});

describe("broadcastSendProcessor", () => {
  it("marks target sent on successful Evolution send", async () => {
    mockedSend.mockResolvedValue({ key: { id: "EVO-1" } } as any);
    const job = { data: { broadcastId, targetId: targetIdSuccess, instanceId, to: "601", text: "hello" } } as any;
    await broadcastSendProcessor(job, "" as any);
    const t = await prisma.broadcastTarget.findUnique({ where: { id: targetIdSuccess } });
    expect(t?.status).toBe("sent");
    expect(t?.evolutionMessageId).toBe("EVO-1");
  });

  it("sends text (no media) when the job carries no mediaAssetId", async () => {
    mockedSend.mockResolvedValue({ key: { id: "EVO-1" } } as any);
    const job = { data: { broadcastId, targetId: targetIdSuccess, instanceId, to: "601", text: "hello" } } as any;
    await broadcastSendProcessor(job, "" as any);
    expect(mediaPayloadFromAsset).not.toHaveBeenCalled();
    expect(mockedSend).toHaveBeenCalledWith(instanceId, { type: "text", to: "601", text: "hello", userId: null }, { origin: "broadcast" });
  });

  it("sends media with the personalized text as caption when the job carries mediaAssetId + workspaceId", async () => {
    mockedSend.mockResolvedValue({ key: { id: "EVO-M" } } as any);
    (mediaPayloadFromAsset as any).mockResolvedValue({ type: "media", to: "601", mediaUrl: "http://web/raw", mediatype: "image", caption: "hello", userId: null });
    const job = { data: { broadcastId, targetId: targetIdSuccess, instanceId, to: "601", text: "hello", mediaAssetId: "asset-1", workspaceId } } as any;
    await broadcastSendProcessor(job, "" as any);
    expect(mediaPayloadFromAsset).toHaveBeenCalledWith("asset-1", workspaceId, "601", "hello");
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ type: "media", caption: "hello" }), { origin: "broadcast" });
    const t = await prisma.broadcastTarget.findUnique({ where: { id: targetIdSuccess } });
    expect(t?.status).toBe("sent");
    expect(t?.evolutionMessageId).toBe("EVO-M");
  });

  it("marks target failed when send throws", async () => {
    mockedSend.mockRejectedValue(new Error("evolution 502"));
    const job = { data: { broadcastId, targetId: targetIdFail, instanceId, to: "602", text: "hello" } } as any;
    await broadcastSendProcessor(job, "" as any);
    const t = await prisma.broadcastTarget.findUnique({ where: { id: targetIdFail } });
    expect(t?.status).toBe("failed");
    expect(t?.error).toMatch(/evolution 502/);
  });

  it("records evolutionMessageId from the send result key.id", async () => {
    mockedSend.mockResolvedValue({ key: { id: "EVO-XYZ" } } as any);
    const job = { data: { broadcastId, targetId: targetIdSuccess, instanceId, to: "601", text: "hi" } } as any;
    await broadcastSendProcessor(job, "" as any);
    const t = await prisma.broadcastTarget.findUnique({ where: { id: targetIdSuccess } });
    expect(t?.evolutionMessageId).toBe("EVO-XYZ");
  });

  it("does not crash on missing key.id (sets status sent with null evolutionMessageId)", async () => {
    mockedSend.mockResolvedValue({ status: "PENDING" } as any);
    const job = { data: { broadcastId, targetId: targetIdSuccess, instanceId, to: "601", text: "hi" } } as any;
    await broadcastSendProcessor(job, "" as any);
    const t = await prisma.broadcastTarget.findUnique({ where: { id: targetIdSuccess } });
    expect(t?.status).toBe("sent");
    expect(t?.evolutionMessageId).toBeNull();
  });
});
