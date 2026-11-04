import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@evo/shared";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@evo/db", () => ({
  prisma: {
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/api-key-auth", () => ({
  verifyApiKey: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { verifyApiKey } from "@/lib/api-key-auth";
import { requireMember } from "./tenancy";

const mockedAuth = vi.mocked(auth);
const mockedFindWorkspace = vi.mocked(prisma.workspace.findUnique);
const mockedFindMember = vi.mocked(prisma.workspaceMember.findUnique);
const mockedVerifyApiKey = vi.mocked(verifyApiKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerifyApiKey.mockResolvedValue(null);
});

describe("requireMember", () => {
  it("throws ForbiddenError when there is no session", async () => {
    mockedAuth.mockResolvedValue(null as any);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when workspace does not exist", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue(null);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when user is not a member", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue(null);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when role is too low", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue({ role: "Viewer" } as any);
    await expect(requireMember("ws", "Admin")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns workspace + role when authorised", async () => {
    mockedAuth.mockResolvedValue({ user: { id: "u1" } } as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws-id", slug: "ws" } as any);
    mockedFindMember.mockResolvedValue({ role: "Admin" } as any);
    const result = await requireMember("ws", "Admin");
    expect(result.workspace.id).toBe("ws-id");
    expect(result.role).toBe("Admin");
    expect(result.userId).toBe("u1");
  });

  it("authenticates a valid workspace API key as Admin when there is no session", async () => {
    mockedAuth.mockResolvedValue(null as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws-id", slug: "ws" } as any);
    mockedVerifyApiKey.mockResolvedValue("key-1");
    const result = await requireMember("ws", "Admin");
    expect(result.role).toBe("Admin");
    expect(result.userId).toBe("apikey:key-1");
    expect(mockedVerifyApiKey).toHaveBeenCalledWith("ws-id");
  });

  it("rejects an API key when the route requires Owner", async () => {
    mockedAuth.mockResolvedValue(null as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws-id", slug: "ws" } as any);
    mockedVerifyApiKey.mockResolvedValue("key-1");
    await expect(requireMember("ws", "Owner")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects when there is no session and no valid API key", async () => {
    mockedAuth.mockResolvedValue(null as any);
    mockedFindWorkspace.mockResolvedValue({ id: "ws-id", slug: "ws" } as any);
    mockedVerifyApiKey.mockResolvedValue(null);
    await expect(requireMember("ws", "Viewer")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
