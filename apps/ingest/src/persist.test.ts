import { describe, it, expect, beforeEach } from "vitest";
import { persistEvent } from "./persist";

const { prisma } = await import("@evo/db");

let workspaceId: string;
let instanceId: string;

beforeEach(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
  const ws = await prisma.workspace.create({ data: { name: "T", slug: "t-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: {
      workspaceId: ws.id,
      label: "main",
      evolutionInstanceName: "evo-" + Date.now(),
      evolutionApiKey: "K",
    },
  });
  workspaceId = ws.id;
  instanceId = inst.id;
});

describe("persistEvent", () => {
  it("creates a conversation + inbound message on first event", async () => {
    const result = await persistEvent({ workspaceId, instanceId }, {
      kind: "message",
      direction: "inbound",
      evolutionMessageId: "M1",
      contactPhone: "60123",
      contactName: "A",
      type: "text",
      body: "hello",
      mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    expect(result.conversation).toBeTruthy();
    expect(result.message?.body).toBe("hello");

    const convs = await prisma.conversation.findMany();
    expect(convs).toHaveLength(1);
    const msgs = await prisma.message.findMany();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.direction).toBe("inbound");
  });

  it("reuses the same conversation for subsequent messages from same contact", async () => {
    await persistEvent({ workspaceId, instanceId }, {
      kind: "message", direction: "inbound", evolutionMessageId: "M2",
      contactPhone: "60111", contactName: null, type: "text", body: "one", mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    await persistEvent({ workspaceId, instanceId }, {
      kind: "message", direction: "inbound", evolutionMessageId: "M3",
      contactPhone: "60111", contactName: null, type: "text", body: "two", mediaUrl: null,
      sentAt: new Date().toISOString(),
    });
    const convs = await prisma.conversation.findMany();
    expect(convs).toHaveLength(1);
    const msgs = await prisma.message.findMany({ orderBy: { sentAt: "asc" } });
    expect(msgs).toHaveLength(2);
  });

  it("is idempotent on duplicate evolutionMessageId", async () => {
    const evt = {
      kind: "message" as const, direction: "inbound" as const, evolutionMessageId: "DUP",
      contactPhone: "60999", contactName: null, type: "text", body: "x", mediaUrl: null,
      sentAt: new Date().toISOString(),
    };
    await persistEvent({ workspaceId, instanceId }, evt);
    await persistEvent({ workspaceId, instanceId }, evt);
    const msgs = await prisma.message.findMany();
    expect(msgs).toHaveLength(1);
  });

  it("updates instance.connectionState on connection event", async () => {
    await persistEvent({ workspaceId, instanceId }, { kind: "connection", state: "close" });
    const inst = await prisma.instance.findUnique({ where: { id: instanceId } });
    expect(inst?.connectionState).toBe("close");
  });
});
