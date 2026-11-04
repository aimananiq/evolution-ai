import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    workspaceMember: { findMany: vi.fn() },
  },
}));

const decodeMock = vi.fn();
vi.mock("@auth/core/jwt", () => ({
  decode: (...args: any[]) => decodeMock(...args),
}));

import { prisma } from "@evo/db";
import { authoriseSocket } from "./socket-auth";

const mockedFindMany = vi.mocked(prisma.workspaceMember.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
});

describe("authoriseSocket", () => {
  it("returns null when there is no cookie", async () => {
    expect(await authoriseSocket(undefined)).toBeNull();
  });

  it("returns null when the session cookie is missing/invalid", async () => {
    decodeMock.mockResolvedValue(null);
    expect(await authoriseSocket("authjs.session-token=bad")).toBeNull();
  });

  it("returns userId and workspaceIds when session decodes", async () => {
    decodeMock.mockResolvedValue({ sub: "u-1" });
    mockedFindMany.mockResolvedValue([{ workspaceId: "w-1" } as any, { workspaceId: "w-2" } as any]);
    const result = await authoriseSocket("authjs.session-token=valid");
    expect(result).toEqual({ userId: "u-1", workspaceIds: ["w-1", "w-2"] });
  });

  it("uses the production secure cookie name as the salt", async () => {
    decodeMock.mockImplementation(async ({ salt }: any) => salt === "__Secure-authjs.session-token" ? { sub: "u-prod" } : null);
    mockedFindMany.mockResolvedValue([{ workspaceId: "wp" } as any]);
    const result = await authoriseSocket("__Secure-authjs.session-token=ok");
    expect(result).toEqual({ userId: "u-prod", workspaceIds: ["wp"] });
  });
});
