import { describe, it, expect, beforeEach } from "vitest";
import { handleInbound } from "./inbound";

const { prisma } = await import("@evo/db");

let workspaceId: string;
let instanceId: string;

async function makeIntegration(over: Partial<{ enabled: boolean; recipientPathKey: string; captionTemplate: string }> = {}) {
  return prisma.inboundIntegration.create({
    data: {
      workspaceId,
      instanceId,
      name: "Webhook #test",
      token: "tok-" + Math.random().toString(36).slice(2),
      enabled: over.enabled ?? true,
      recipientPathKey: over.recipientPathKey ?? "billing.billing_phone",
      captionTemplate: over.captionTemplate ?? "Hi {{billing.first_name}}, order {{order.id}} received.",
    },
  });
}

beforeEach(async () => {
  await prisma.inboundIntegrationLog.deleteMany();
  await prisma.inboundIntegration.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "t-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "main", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
});

describe("handleInbound", () => {
  it("404s for an unknown token", async () => {
    const r = await handleInbound("does-not-exist", { a: 1 });
    expect(r.status).toBe(404);
  });

  it("resolves recipient, writes a received log, and stores the sample", async () => {
    const integ = await makeIntegration();
    const payload = { billing: { billing_phone: "+60 12-345 6789", first_name: "Aiman" }, order: { id: 7 } };
    const r = await handleInbound(integ.token, payload);
    expect(r.status).toBe(200);

    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe("received");
    expect(logs[0]?.resolvedPhone).toBe("60123456789");

    const fresh = await prisma.inboundIntegration.findUnique({ where: { id: integ.id } });
    expect(fresh?.lastReceivedAt).toBeTruthy();
    expect((fresh?.lastSamplePayload as any).order.id).toBe(7);
  });

  it("logs no_recipient + 422 when path is missing", async () => {
    const integ = await makeIntegration({ recipientPathKey: "billing.nope" });
    const r = await handleInbound(integ.token, { billing: { first_name: "X" } });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("NO_RECIPIENT");
    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs[0]?.status).toBe("no_recipient");
  });

  it("stores sample but does NOT log/send when disabled", async () => {
    const integ = await makeIntegration({ enabled: false });
    const r = await handleInbound(integ.token, { billing: { billing_phone: "60123456789" } });
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe("disabled");
    const logs = await prisma.inboundIntegrationLog.findMany();
    expect(logs).toHaveLength(0);
    const fresh = await prisma.inboundIntegration.findUnique({ where: { id: integ.id } });
    expect(fresh?.lastSamplePayload).toBeTruthy();
  });
});
