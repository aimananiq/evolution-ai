import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
}));

const { prisma } = await import("@evo/db");
const { sendViaInstance } = await import("@evo/send");
const { runDripTick } = await import("./drip-tick");

const mockedSend = vi.mocked(sendViaInstance);

let workspaceId: string;
let instanceId: string;
let contactId: string;
let templateAId: string;
let templateBId: string;
let campaignId: string;

async function reset() {
  await prisma.dripEnrolment.deleteMany();
  await prisma.dripCampaign.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "D", slug: "d-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  const contact = await prisma.contact.create({ data: { workspaceId: ws.id, phoneE164: "60111" } });
  const tA = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "A", body: "first" } });
  const tB = await prisma.messageTemplate.create({ data: { workspaceId: ws.id, name: "B", body: "second" } });
  const camp = await prisma.dripCampaign.create({
    data: {
      workspaceId: ws.id, instanceId: inst.id, name: "C1", triggerType: "manual",
      steps: [{ templateId: tA.id, delayMs: 0 }, { templateId: tB.id, delayMs: 1000 }] as any,
    },
  });
  workspaceId = ws.id; instanceId = inst.id; contactId = contact.id;
  templateAId = tA.id; templateBId = tB.id; campaignId = camp.id;
});

describe("runDripTick", () => {
  it("advances a due enrolment from step 0 to step 1, sending the first template", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() - 1000) },
    });
    const { advanced } = await runDripTick();
    expect(advanced).toBe(1);
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "first" }), expect.objectContaining({ origin: "drip" }));
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.currentStep).toBe(1);
    expect(enr?.status).toBe("active");
  });

  it("marks completed when the last step finishes", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 1, nextRunAt: new Date(Date.now() - 1000) },
    });
    await runDripTick();
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.status).toBe("completed");
    expect(mockedSend).toHaveBeenCalledWith(instanceId, expect.objectContaining({ text: "second" }), expect.objectContaining({ origin: "drip" }));
  });

  it("does not advance enrolments that are not yet due", async () => {
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() + 60000) },
    });
    const { advanced } = await runDripTick();
    expect(advanced).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("marks failed when sendViaInstance throws", async () => {
    mockedSend.mockRejectedValue(new Error("evo down"));
    await prisma.dripEnrolment.create({
      data: { workspaceId, campaignId, contactId, currentStep: 0, nextRunAt: new Date(Date.now() - 1000) },
    });
    await runDripTick();
    const enr = await prisma.dripEnrolment.findFirst();
    expect(enr?.status).toBe("failed");
  });

  it("ignores due enrolments belonging to __followup__ campaigns", async () => {
    const followupCamp = await prisma.dripCampaign.create({
      data: {
        workspaceId,
        instanceId,
        name: "__followup__cbX",
        active: false,
        triggerType: "manual",
        steps: [{ text: "Hi, following up!", delaySeconds: 3600 }] as any,
      },
    });
    const enr = await prisma.dripEnrolment.create({
      data: {
        workspaceId,
        campaignId: followupCamp.id,
        contactId,
        currentStep: 0,
        nextRunAt: new Date(Date.now() - 1000),
      },
    });
    const { advanced } = await runDripTick();
    // The follow-up enrolment must not have been processed by drip-tick
    expect(advanced).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
    const refreshed = await prisma.dripEnrolment.findUnique({ where: { id: enr.id } });
    expect(refreshed?.status).toBe("active");
  });
});
