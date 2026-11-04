import { describe, it, expect, beforeEach } from "vitest";
const { prisma } = await import("@evo/db");
const { runHealthTick } = await import("./health-tick");

let workspaceId: string;
let instanceId: string;

async function reset() {
  await prisma.healthAlert.deleteMany();
  await prisma.instanceHealthSnapshot.deleteMany();
  await prisma.instanceHealthPolicy.deleteMany();
  await prisma.broadcastTarget.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.contactListMember.deleteMany();
  await prisma.contactList.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

async function seedSpammy() {
  const ws = await prisma.workspace.create({ data: { name: "H", slug: "h-" + Date.now() } });
  workspaceId = ws.id;
  const inst = await prisma.instance.create({
    data: { workspaceId, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K" },
  });
  instanceId = inst.id;
  // 15 outbound-only conversations => reply ratio 0, sufficient data.
  for (let i = 0; i < 15; i++) {
    const c = await prisma.conversation.create({ data: { workspaceId, instanceId, contactPhone: "60" + i } });
    await prisma.message.create({ data: { workspaceId, conversationId: c.id, direction: "outbound", type: "text", body: "hi" } });
  }
  // A broadcast with all-failed targets => high failure rate, pushing the score to at_risk.
  const list = await prisma.contactList.create({ data: { workspaceId, name: "seed-list" } });
  const bc = await prisma.broadcast.create({
    data: { workspaceId, instanceId, listId: list.id, name: "seed-bc", status: "completed", createdByUserId: "u" } as any,
  });
  for (let i = 0; i < 5; i++) {
    const contact = await prisma.contact.create({ data: { workspaceId, phoneE164: "70" + i } });
    await prisma.broadcastTarget.create({
      data: { workspaceId, broadcastId: bc.id, contactId: contact.id, status: "failed", error: "boom" },
    });
  }
}

beforeEach(async () => {
  await reset();
  await seedSpammy();
});

describe("runHealthTick", () => {
  it("writes a snapshot and raises a went_at_risk alert", async () => {
    const r = await runHealthTick({ now: new Date() });
    expect(r.snapshotted).toBeGreaterThanOrEqual(1);
    const snap = await prisma.instanceHealthSnapshot.findFirst({ where: { instanceId } });
    expect(snap?.risk).toBe("at_risk");
    const alert = await prisma.healthAlert.findFirst({ where: { instanceId, kind: "went_at_risk" } });
    expect(alert).not.toBeNull();
  });

  it("does not duplicate the went_at_risk alert on a second tick same risk", async () => {
    await runHealthTick({ now: new Date() });
    await runHealthTick({ now: new Date() });
    const count = await prisma.healthAlert.count({ where: { instanceId, kind: "went_at_risk" } });
    expect(count).toBe(1);
  });

  it("auto-protects running broadcasts when policy.autoProtect is on", async () => {
    await prisma.instanceHealthPolicy.create({
      data: { instanceId, workspaceId, autoProtect: true },
    });
    const list = await prisma.contactList.create({ data: { workspaceId, name: "L" } });
    const b = await prisma.broadcast.create({
      data: { workspaceId, instanceId, listId: list.id, name: "B", status: "running", createdByUserId: "u" } as any,
    });
    await runHealthTick({ now: new Date() });
    const after = await prisma.broadcast.findUnique({ where: { id: b.id } });
    expect(after?.status).toBe("paused");
    const alert = await prisma.healthAlert.findFirst({ where: { instanceId, kind: "auto_protected" } });
    expect(alert).not.toBeNull();
  });
});
