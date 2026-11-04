import { execSync } from "node:child_process";
import { beforeAll } from "vitest";

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
  execSync(`node_modules/.bin/prisma migrate deploy`, {
    cwd: __dirname + "/..",
    env: { ...process.env },
    stdio: "inherit",
  });
});
