import { describe, it, expect, beforeEach } from "vitest";
import { handleProbeReceipt } from "./canary-receipt";
import type { NormalisedEvent } from "./normalise";

const { prisma } = await import("@evo/db");

let workspaceId: string;
let instanceId: string;
let controlInstanceId: string;

beforeEach(async () => {
  await prisma.deliverabilityProbe.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "t-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: {
      workspaceId: ws.id,
      label: "sender",
      evolutionInstanceName: "evo-s-" + Date.now(),
      evolutionApiKey: "K",
      deliveryStatus: "delivery_failing",
      deliveryMissStreak: 3,
    },
  });
  const control = await prisma.instance.create({
    data: {
      workspaceId: ws.id,
      label: "control",
      evolutionInstanceName: "evo-c-" + Date.now(),
      evolutionApiKey: "K",
    },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
  controlInstanceId = control.id;
});

function probeEvent(body: string): NormalisedEvent {
  return {
    kind: "message",
    direction: "inbound",
    evolutionMessageId: "PM1",
    contactPhone: "60123",
    contactName: null,
    type: "text",
    body,
    mediaUrl: null,
    sentAt: new Date().toISOString(),
  };
}

describe("handleProbeReceipt", () => {
  it("marks a pending probe delivered, clears the sender flag, and swallows", async () => {
    const probe = await prisma.deliverabilityProbe.create({
      data: {
        workspaceId,
        instanceId,
        controlInstanceId,
        token: "TOKEN123",
        status: "pending",
      },
    });

    const swallowed = await handleProbeReceipt(probeEvent("wasap-probe:TOKEN123"));
    expect(swallowed).toBe(true);

    const updated = await prisma.deliverabilityProbe.findUnique({ where: { id: probe.id } });
    expect(updated?.status).toBe("delivered");
    expect(updated?.receivedAt).toBeTruthy();

    const inst = await prisma.instance.findUnique({ where: { id: instanceId } });
    expect(inst?.deliveryStatus).toBe("ok");
    expect(inst?.deliveryMissStreak).toBe(0);

    const convs = await prisma.conversation.findMany();
    expect(convs).toHaveLength(0);
  });

  it("returns false for a normal message (not a probe)", async () => {
    const swallowed = await handleProbeReceipt(probeEvent("hello there"));
    expect(swallowed).toBe(false);
  });

  it("swallows an unknown/expired probe token without touching instances", async () => {
    const swallowed = await handleProbeReceipt(probeEvent("wasap-probe:NOPE"));
    expect(swallowed).toBe(true);
    const inst = await prisma.instance.findUnique({ where: { id: instanceId } });
    // Unknown token: nothing to clear, sender flag stays as-is.
    expect(inst?.deliveryStatus).toBe("delivery_failing");
  });
});
