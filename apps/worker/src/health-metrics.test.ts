import { describe, it, expect, beforeEach } from "vitest";
const { prisma } = await import("@evo/db");
const { collectMetrics } = await import("./health-metrics");

let workspaceId: string;
let instanceId: string;

async function reset() {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.broadcastTarget.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.instanceHealthPolicy.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "H", slug: "h-" + Date.now() } });
  workspaceId = ws.id;
  const inst = await prisma.instance.create({
    data: { workspaceId, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  instanceId = inst.id;
});

describe("collectMetrics", () => {
  it("computes reply ratio from conversations with inbound vs outbound-only", async () => {
    // conv A: outbound + inbound (replied)
    const a = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "601" } });
    await prisma.message.create({ data: { workspaceId, conversationId: a.id, direction: "outbound", type: "text", body: "hi" } });
    await prisma.message.create({ data: { workspaceId, conversationId: a.id, direction: "inbound", type: "text", body: "yo" } });
    // conv B: outbound only (no reply)
    const b = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "602" } });
    await prisma.message.create({ data: { workspaceId, conversationId: b.id, direction: "outbound", type: "text", body: "hi" } });

    const m = await collectMetrics(instanceId, workspaceId, new Date());
    expect(m.businessInitiatedConversations).toBe(2);
    expect(m.replyRatio).toBeCloseTo(0.5, 5);
    expect(m.outboundOnlyConversationPct).toBeCloseTo(0.5, 5);
  });
});
