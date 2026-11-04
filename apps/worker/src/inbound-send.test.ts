import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn(), mediaPayloadFromAsset: vi.fn() }));

const { sendViaInstance, mediaPayloadFromAsset } = await import("@evo/send");
const { prisma } = await import("@evo/db");
const { inboundSendProcessor } = await import("./inbound-send");

let workspaceId: string;
let instanceId: string;
let integrationId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.inboundIntegrationLog.deleteMany();
  await prisma.inboundIntegration.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "w-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "m", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const integ = await prisma.inboundIntegration.create({
    data: { workspaceId: ws.id, instanceId: inst.id, name: "W", token: "t-" + Date.now(), recipientPathKey: "p", captionTemplate: "x" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
  integrationId = integ.id;
});

function job(logId: string) {
  return { data: { integrationId, instanceId, to: "60123456789", text: "hi", logId } } as any;
}

describe("inboundSendProcessor", () => {
  it("marks the log 'sent' on success", async () => {
    (sendViaInstance as any).mockResolvedValue({ key: { id: "X" } });
    const log = await prisma.inboundIntegrationLog.create({
      data: { workspaceId, integrationId, payload: {}, resolvedPhone: "60123456789", status: "received" },
    });
    await inboundSendProcessor(job(log.id), "" as any);
    expect(sendViaInstance).toHaveBeenCalledWith(instanceId, { type: "text", to: "60123456789", text: "hi", userId: null }, { origin: "inbound" });
    const fresh = await prisma.inboundIntegrationLog.findUnique({ where: { id: log.id } });
    expect(fresh?.status).toBe("sent");
  });

  it("sends media with the rendered text as caption when the job carries a mediaAssetId", async () => {
    (sendViaInstance as any).mockResolvedValue({ key: { id: "X" } });
    (mediaPayloadFromAsset as any).mockResolvedValue({ type: "media", to: "60123456789", mediaUrl: "http://web/raw", mediatype: "image", caption: "hi", userId: null });
    const log = await prisma.inboundIntegrationLog.create({
      data: { workspaceId, integrationId, payload: {}, resolvedPhone: "60123456789", status: "received" },
    });
    const mediaJob = { data: { integrationId, instanceId, to: "60123456789", text: "hi", logId: log.id, workspaceId, mediaAssetId: "asset-1" } } as any;
    await inboundSendProcessor(mediaJob, "" as any);
    expect(mediaPayloadFromAsset).toHaveBeenCalledWith("asset-1", workspaceId, "60123456789", "hi");
    expect(sendViaInstance).toHaveBeenCalledWith(instanceId, expect.objectContaining({ type: "media", caption: "hi" }), { origin: "inbound" });
    const fresh = await prisma.inboundIntegrationLog.findUnique({ where: { id: log.id } });
    expect(fresh?.status).toBe("sent");
  });

  it("marks the log 'failed' and rethrows on send error", async () => {
    (sendViaInstance as any).mockRejectedValue(new Error("boom"));
    const log = await prisma.inboundIntegrationLog.create({
      data: { workspaceId, integrationId, payload: {}, resolvedPhone: "60123456789", status: "received" },
    });
    await expect(inboundSendProcessor(job(log.id), "" as any)).rejects.toThrow("boom");
    const fresh = await prisma.inboundIntegrationLog.findUnique({ where: { id: log.id } });
    expect(fresh?.status).toBe("failed");
    expect(fresh?.error).toContain("boom");
  });
});
