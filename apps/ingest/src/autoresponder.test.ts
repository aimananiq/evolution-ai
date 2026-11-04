import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist the mocks so they are available inside vi.mock factories.
const { sendViaInstance, mediaPayloadFromAsset, redisGet, redisSet, isWithinSchedule, prisma } = vi.hoisted(() => {
  const sendViaInstance = vi.fn().mockResolvedValue({ key: { id: "m1" } });
  const mediaPayloadFromAsset = vi.fn().mockResolvedValue(null);
  const redisGet = vi.fn();
  const redisSet = vi.fn();
  const isWithinSchedule = vi.fn().mockReturnValue(true);
  const prisma = {
    autoresponder: { findUnique: vi.fn() },
    contactListMember: { count: vi.fn().mockResolvedValue(0) },
  };
  return { sendViaInstance, mediaPayloadFromAsset, redisGet, redisSet, isWithinSchedule, prisma };
});

vi.mock("@evo/send", () => ({ sendViaInstance, mediaPayloadFromAsset }));
vi.mock("@evo/queue", () => ({ redis: () => ({ get: redisGet, set: redisSet }) }));
vi.mock("@evo/schedule", () => ({ isWithinSchedule }));
vi.mock("@evo/db", () => ({ prisma }));

import { runAutoresponder } from "./autoresponder";

const base = {
  workspaceId: "w1", instanceId: "i1", contactPhone: "60123456789", inboundText: "hi", isGroup: false,
};
const cfg = {
  enabled: true, sendTo: "all", text: "Auto reply", pausePerCustomerSec: 60,
  scheduleJson: null, excludeContactListIds: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
  isWithinSchedule.mockReturnValue(true);
  redisGet.mockResolvedValue(null);
  mediaPayloadFromAsset.mockResolvedValue(null);
  prisma.autoresponder.findUnique.mockResolvedValue(cfg);
  prisma.contactListMember.count.mockResolvedValue(0);
});

describe("runAutoresponder", () => {
  it("sends when all gates pass and arms the pause key", async () => {
    const sent = await runAutoresponder(base);
    expect(sent).toBe(true);
    expect(sendViaInstance).toHaveBeenCalledWith("i1", expect.objectContaining({ to: "60123456789", text: "Auto reply" }), expect.objectContaining({ origin: "autoresponder" }));
    expect(redisSet).toHaveBeenCalledWith("autoresp:pause:i1:60123456789", "1", "EX", 60);
  });

  it("sends media (caption preferred) when mediaAssetId resolves", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, mediaAssetId: "asset-1", caption: "See attached" });
    mediaPayloadFromAsset.mockResolvedValue({ type: "media", to: "60123456789", mediaUrl: "http://web/raw", mediatype: "image", caption: "See attached", userId: null });
    const sent = await runAutoresponder(base);
    expect(sent).toBe(true);
    expect(mediaPayloadFromAsset).toHaveBeenCalledWith("asset-1", "w1", "60123456789", "See attached");
    expect(sendViaInstance).toHaveBeenCalledWith("i1", expect.objectContaining({ type: "media", caption: "See attached" }), expect.objectContaining({ origin: "autoresponder" }));
  });

  it("does not send when neither text nor a resolvable media asset is configured", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, text: null, mediaAssetId: null });
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send when disabled", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, enabled: false });
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send outside the schedule window", async () => {
    isWithinSchedule.mockReturnValue(false);
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send while paused (Redis key present)", async () => {
    redisGet.mockResolvedValue("1");
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send to an excluded contact list member", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, excludeContactListIds: ["L1"] });
    prisma.contactListMember.count.mockResolvedValue(1);
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("skips group messages when sendTo=individual", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, sendTo: "individual" });
    expect(await runAutoresponder({ ...base, isGroup: true })).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("skips non-group messages when sendTo=group", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, sendTo: "group" });
    expect(await runAutoresponder({ ...base, isGroup: false })).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not send when autoresponder not in DB", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue(null);
    expect(await runAutoresponder(base)).toBe(false);
    expect(sendViaInstance).not.toHaveBeenCalled();
  });

  it("does not arm pause key when pausePerCustomerSec=0", async () => {
    prisma.autoresponder.findUnique.mockResolvedValue({ ...cfg, pausePerCustomerSec: 0 });
    const sent = await runAutoresponder(base);
    expect(sent).toBe(true);
    expect(redisGet).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("fails open when Redis get throws (still sends)", async () => {
    redisGet.mockRejectedValue(new Error("Redis down"));
    const sent = await runAutoresponder(base);
    expect(sent).toBe(true);
    expect(sendViaInstance).toHaveBeenCalled();
  });
});
