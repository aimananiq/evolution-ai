import { describe, it, expect, beforeEach, vi } from "vitest";

const addMock = vi.fn();

const { prisma } = await import("@evo/db");
const { runWarmerTick } = await import("./warmer-tick");

let workspaceId: string;
let instanceId: string;
let profileId: string;
let runId: string;

async function reset() {
  await prisma.warmerEvent.deleteMany();
  await prisma.warmerRun.deleteMany();
  await prisma.warmerTemplate.deleteMany();
  await prisma.warmerProfile.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.workspace.deleteMany();
}

beforeEach(async () => {
  addMock.mockReset();
  await reset();
  const ws = await prisma.workspace.create({ data: { name: "W", slug: "w-" + Date.now() } });
  const inst = await prisma.instance.create({
    data: { workspaceId: ws.id, label: "x", evolutionInstanceName: "evo-" + Date.now(), evolutionApiKey: "K", connectionState: "open" },
  });
  const profile = await prisma.warmerProfile.create({
    data: {
      workspaceId: ws.id, name: "p1",
      config: {
        mode: "pair",
        participatingInstanceIds: [inst.id],
        outboundPartners: [{ number: "60134", label: "main" }],
        schedule: { startHour: 0, endHour: 24, skipProbability: 0 },
        pacing: { typingPerCharMs: 100, typingMinMs: 1000, typingMaxMs: 5000, replyMinMs: 0, replyMaxMs: 100, minTurnsPerConversation: 3, maxTurnsPerConversation: 5 },
        timeOfDayWeights: new Array(24).fill(1),
        dayOfWeekWeights: new Array(7).fill(1),
      } as any,
    },
  });
  const run = await prisma.warmerRun.create({
    data: { workspaceId: ws.id, profileId: profile.id, status: "running" },
  });
  await prisma.warmerTemplate.create({ data: { workspaceId: ws.id, body: "hello" } });
  workspaceId = ws.id; instanceId = inst.id; profileId = profile.id; runId = run.id;
});

describe("runWarmerTick", () => {
  it("enqueues a warmer-send job for a running profile with templates", async () => {
    const sendQueue = { add: addMock } as any;
    const { enqueued } = await runWarmerTick(sendQueue, { now: new Date("2026-06-18T12:00:00Z") });
    expect(enqueued).toBe(1);
    expect(addMock).toHaveBeenCalledWith("send", expect.objectContaining({ runId, instanceId, to: "60134", text: "hello" }), expect.objectContaining({ delay: expect.any(Number) }));
    const events = await prisma.warmerEvent.findMany();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("skips runs whose status is not running", async () => {
    await prisma.warmerRun.update({ where: { id: runId }, data: { status: "stopped" } });
    const sendQueue = { add: addMock } as any;
    const { enqueued } = await runWarmerTick(sendQueue, { now: new Date("2026-06-18T12:00:00Z") });
    expect(enqueued).toBe(0);
  });

  it("skips when no templates exist for the workspace", async () => {
    await prisma.warmerTemplate.deleteMany();
    const sendQueue = { add: addMock } as any;
    const { enqueued } = await runWarmerTick(sendQueue, { now: new Date("2026-06-18T12:00:00Z") });
    expect(enqueued).toBe(0);
  });
});
