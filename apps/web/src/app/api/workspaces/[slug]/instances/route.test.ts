import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

// Set DATABASE_URL before any module-level PrismaClient instantiation occurs.
// Tests must only ever run against the *_test database. FORCE it — an inherited
// DATABASE_URL (e.g. a sourced .env pointing at the dev DB) must never leak into
// test runs: these suites call deleteMany() and would wipe real data.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://manager:manager@localhost:5433/evolution_manager_test?schema=public";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
if (!process.env.DATABASE_URL.includes("_test")) {
  throw new Error("refusing to run tests against non-test database: " + process.env.DATABASE_URL);
}

beforeAll(() => {
  execSync("node_modules/.bin/prisma migrate deploy", {
    cwd: __dirname + "/../../../../../../../../packages/db",
    stdio: "inherit",
    env: { ...process.env },
  });
});

const { prisma, tenantClient } = await import("@evo/db");

describe("tenant isolation: instances", () => {
  it("workspace B cannot read instances created in workspace A", async () => {
    await prisma.auditLog.deleteMany();
    await prisma.instance.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();

    const a = await prisma.workspace.create({ data: { name: "A", slug: "a-" + Date.now() } });
    const b = await prisma.workspace.create({ data: { name: "B", slug: "b-" + Date.now() } });

    const dbA = tenantClient(a.id);
    await dbA.instance.create({
      data: {
        label: "in-A",
        evolutionInstanceName: "evo-a-" + Date.now(),
        evolutionApiKey: "k",
      } as any,
    });

    const dbB = tenantClient(b.id);
    const listForB = await dbB.instance.findMany();
    expect(listForB).toHaveLength(0);

    const listForA = await dbA.instance.findMany();
    expect(listForA).toHaveLength(1);
  });
});
