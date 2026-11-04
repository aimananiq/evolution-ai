import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./index";
import { tenantClient } from "./tenant";

describe("tenantClient", () => {
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    await prisma.workspaceMember.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();
    const a = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
    const b = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });
    workspaceA = a.id;
    workspaceB = b.id;
    await prisma.invitation.create({
      data: { workspaceId: workspaceA, email: "x@a.com", role: "Agent", token: "ta" + Date.now(), expiresAt: new Date(Date.now() + 86400000) },
    });
    await prisma.invitation.create({
      data: { workspaceId: workspaceB, email: "y@b.com", role: "Agent", token: "tb" + Date.now(), expiresAt: new Date(Date.now() + 86400000) },
    });
  });

  it("findMany on Invitation only returns rows for the bound workspace", async () => {
    const db = tenantClient(workspaceA);
    const found = await db.invitation.findMany();
    expect(found).toHaveLength(1);
    expect(found[0]?.workspaceId).toBe(workspaceA);
  });

  it("create() forces workspaceId even when caller passes a different one", async () => {
    const db = tenantClient(workspaceA);
    const created = await db.invitation.create({
      data: {
        workspaceId: workspaceB, // attempt to sneak across
        email: "z@a.com",
        role: "Agent",
        token: "tz" + Date.now(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    expect(created.workspaceId).toBe(workspaceA);
  });

  it("does not affect untenanted models like User", async () => {
    const db = tenantClient(workspaceA);
    await prisma.user.create({ data: { email: "u@e.com", passwordHash: "x", name: "U" } });
    const users = await db.user.findMany();
    expect(users.length).toBeGreaterThanOrEqual(1);
  });
});
