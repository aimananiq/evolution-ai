import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    instance: { findUnique: vi.fn() },
  },
}));

vi.mock("@evo/send", () => ({
  sendViaInstance: vi.fn(),
}));

vi.mock("./audit", () => ({
  writeAudit: vi.fn(),
}));

import { prisma } from "@evo/db";
import { sendViaInstance as rawSend } from "@evo/send";
import { writeAudit } from "./audit";
import { sendViaInstance } from "./send";

const findInstance = vi.mocked(prisma.instance.findUnique);
const mockedRaw = vi.mocked(rawSend);
const mockedAudit = vi.mocked(writeAudit);

beforeEach(() => vi.clearAllMocks());

describe("sendViaInstance (web wrapper)", () => {
  it("calls @evo/send and then writeAudit", async () => {
    mockedRaw.mockResolvedValue({ key: { id: "mid-1" }, status: "PENDING" } as any);
    findInstance.mockResolvedValue({ id: "inst-1", workspaceId: "ws-1" } as any);
    const result = await sendViaInstance("inst-1", { type: "text", to: "60123", text: "hi", userId: "u-1" });
    expect(mockedRaw).toHaveBeenCalledWith("inst-1", expect.objectContaining({ to: "60123" }));
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-1",
      action: "message.sent",
    }));
    expect(result).toEqual({ key: { id: "mid-1" }, status: "PENDING" });
  });

  it("propagates throttle errors", async () => {
    mockedRaw.mockRejectedValue(new Error("throttled: bucket empty for instance inst-1 after 300000ms"));
    findInstance.mockResolvedValue({ id: "inst-1", workspaceId: "ws-1" } as any);
    await expect(sendViaInstance("inst-1", { type: "text", to: "60123", text: "hi", userId: "u-1" }))
      .rejects.toThrow(/throttl/);
  });

  it("calls @evo/send with media payload and writes audit with mediatype", async () => {
    mockedRaw.mockResolvedValue({ key: { id: "mid-2" }, status: "PENDING" } as any);
    findInstance.mockResolvedValue({ id: "inst-1", workspaceId: "ws-1" } as any);
    const result = await sendViaInstance("inst-1", {
      type: "media",
      to: "60123",
      mediaUrl: "http://web:3000/api/workspaces/acme/media/abc123/raw",
      mediatype: "image",
      caption: "Look at this",
      userId: "u-1",
    });
    expect(mockedRaw).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ type: "media", mediatype: "image" })
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "message.sent", diff: expect.objectContaining({ mediatype: "image" }) })
    );
    expect(result).toEqual({ key: { id: "mid-2" }, status: "PENDING" });
  });
});
