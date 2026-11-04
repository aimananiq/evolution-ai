import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    instance: { findUnique: vi.fn() },
    instanceHealthPolicy: { findUnique: vi.fn() },
  },
}));
vi.mock("@evo/queue", () => ({
  redis: vi.fn(),
  tokenBucket: () => ({ take: async () => ({ granted: true, waitedMs: 0, remaining: 9 }) }),
}));
vi.mock("@evo/evolution-client", () => ({
  EvolutionClient: class {},
  MessageApi: class {
    async sendPresence() {}
    async sendText() { return { key: { id: "m1" } }; }
    async sendMedia() { return { key: { id: "m2" } }; }
  },
}));

const { prisma } = await import("@evo/db");
const { redis } = await import("@evo/queue");
const { sendViaInstance, RampCapError } = await import("./index");

const mockInstance = { id: "i1", workspaceId: "w1", evolutionInstanceName: "evo", evolutionApiKey: "k" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVOLUTION_BASE_URL = "http://evo";
  (prisma.instance.findUnique as any).mockResolvedValue(mockInstance);
});

describe("sendViaInstance origin + ramp", () => {
  it("does not count or block conversational origins", async () => {
    const incr = vi.fn();
    (redis as any).mockReturnValue({ incr, expire: vi.fn() });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({ rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date() });
    const r = await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "manual" });
    expect(r?.key?.id).toBe("m1");
    expect(incr).not.toHaveBeenCalled();
  });

  it("counts bulk origins and increments the counter", async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn();
    (redis as any).mockReturnValue({ incr, expire });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue(null); // no ramp
    await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" });
    expect(incr).toHaveBeenCalledOnce();
  });

  it("throws RampCapError when bulk cap is reached", async () => {
    const incr = vi.fn(); const expire = vi.fn();
    (redis as any).mockReturnValue({ incr, expire, get: vi.fn().mockResolvedValue("1") });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({
      rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date(),
    });
    await expect(
      sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" }),
    ).rejects.toBeInstanceOf(RampCapError);
    expect(incr).not.toHaveBeenCalled();
  });

  it("fails open (sends) if redis throws", async () => {
    (redis as any).mockReturnValue({ get: vi.fn().mockRejectedValue(new Error("down")), incr: vi.fn().mockRejectedValue(new Error("down")), expire: vi.fn() });
    (prisma.instanceHealthPolicy.findUnique as any).mockResolvedValue({ rampEnabled: true, rampBaseDaily: 1, rampGrowthPct: 0, rampMaxDaily: 1, rampStartedAt: new Date() });
    const r = await sendViaInstance("i1", { type: "text", to: "601", text: "hi", userId: null }, { origin: "broadcast" });
    expect(r?.key?.id).toBe("m1");
  });
});
