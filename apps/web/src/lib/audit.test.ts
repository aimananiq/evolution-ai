import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    auditLog: { create: vi.fn() },
  },
}));

import { prisma } from "@evo/db";
import { writeAudit } from "./audit";

const mockedCreate = vi.mocked(prisma.auditLog.create);

beforeEach(() => vi.clearAllMocks());

describe("writeAudit", () => {
  it("passes the row straight to prisma.auditLog.create", async () => {
    mockedCreate.mockResolvedValue({} as any);
    await writeAudit({
      workspaceId: "ws-1",
      userId: "u-1",
      action: "instance.created",
      target: "instance:inst-1",
      diff: { instanceName: "x" },
      instanceId: "inst-1",
    });
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "ws-1",
        userId: "u-1",
        action: "instance.created",
        target: "instance:inst-1",
        diff: { instanceName: "x" },
        instanceId: "inst-1",
      },
    });
  });

  it("accepts a null userId for system-initiated actions", async () => {
    mockedCreate.mockResolvedValue({} as any);
    await writeAudit({
      workspaceId: "ws-1",
      userId: null,
      action: "instance.connectionState.changed",
      target: "instance:inst-1",
    });
    expect(mockedCreate.mock.calls[0]?.[0].data.userId).toBeNull();
  });

  it("does not throw if prisma errors — audit failures must never break callers", async () => {
    mockedCreate.mockRejectedValue(new Error("db down"));
    await expect(
      writeAudit({ workspaceId: "ws-1", userId: "u-1", action: "x", target: "y" })
    ).resolves.toBeUndefined();
  });
});
