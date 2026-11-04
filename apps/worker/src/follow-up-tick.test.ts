import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@evo/send", () => ({ sendViaInstance: vi.fn(), mediaPayloadFromAsset: vi.fn().mockResolvedValue(null) }));
const { prisma } = await import("@evo/db");
const { sendViaInstance, mediaPayloadFromAsset } = await import("@evo/send");
const { runFollowUpTick } = await import("./follow-up-tick");
const mockedSend = vi.mocked(sendViaInstance);
const mockedMedia = vi.mocked(mediaPayloadFromAsset);

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.botUserLog.deleteMany();
  await prisma.dripEnrolment.deleteMany();
  await prisma.dripCampaign.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
});

it("sends due follow-up step, logs and advances/completes", async () => {
  const ws = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e-" + Date.now(), evolutionApiKey: "K" } });
  const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60123" } });
  const camp = await prisma.dripCampaign.create({ data: { workspaceId: ws.id, instanceId: inst.id, name: "__followup__cb1", triggerType: "manual", active: false, steps: [{ text: "Ping!", delaySeconds: 0 }] as any } });
  await prisma.dripEnrolment.create({ data: { workspaceId: ws.id, campaignId: camp.id, contactId: c.id, currentStep: 0, status: "active", nextRunAt: new Date(Date.now() - 1000) } });

  const { sent } = await runFollowUpTick();
  expect(sent).toBe(1);
  expect(mockedSend).toHaveBeenCalledWith(inst.id, expect.objectContaining({ text: "Ping!" }), expect.objectContaining({ origin: "followup" }));
  expect(await prisma.botUserLog.count({ where: { kind: "follow_up_sent" } })).toBe(1);
  const e = await prisma.dripEnrolment.findFirst();
  expect(e?.status).toBe("completed");
});

it("sends a step's media asset with the step text as caption", async () => {
  const ws = await prisma.workspace.create({ data: { name: "M", slug: "m-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e3-" + Date.now(), evolutionApiKey: "K" } });
  const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60125" } });
  const camp = await prisma.dripCampaign.create({ data: { workspaceId: ws.id, instanceId: inst.id, name: "__followup__cb2", triggerType: "manual", active: false, steps: [{ text: "Catalogue", delaySeconds: 0, mediaAssetId: "asset-9" }] as any } });
  await prisma.dripEnrolment.create({ data: { workspaceId: ws.id, campaignId: camp.id, contactId: c.id, currentStep: 0, status: "active", nextRunAt: new Date(Date.now() - 1000) } });
  mockedMedia.mockResolvedValueOnce({ type: "media", to: "60125", mediaUrl: "http://web/raw", mediatype: "document", caption: "Catalogue", userId: null } as any);

  const { sent } = await runFollowUpTick();
  expect(sent).toBe(1);
  expect(mockedMedia).toHaveBeenCalledWith("asset-9", ws.id, "60125", "Catalogue");
  expect(mockedSend).toHaveBeenCalledWith(inst.id, expect.objectContaining({ type: "media", caption: "Catalogue" }), expect.objectContaining({ origin: "followup" }));
});

it("ignores normal (non-followup) drip campaigns", async () => {
  const ws = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });
  const inst = await prisma.instance.create({ data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "e2-" + Date.now(), evolutionApiKey: "K" } });
  const c = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60124" } });
  const camp = await prisma.dripCampaign.create({ data: { workspaceId: ws.id, instanceId: inst.id, name: "Regular drip", triggerType: "manual", active: true, steps: [{ templateId: "t", delayMs: 0 }] as any } });
  await prisma.dripEnrolment.create({ data: { workspaceId: ws.id, campaignId: camp.id, contactId: c.id, currentStep: 0, status: "active", nextRunAt: new Date(Date.now() - 1000) } });
  const { sent } = await runFollowUpTick();
  expect(sent).toBe(0);
  expect(mockedSend).not.toHaveBeenCalled();
});
