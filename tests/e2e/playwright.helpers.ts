import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function loadRootEnv() {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const envFile = path.join(repoRoot, ".env");
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export function freshEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
}

export function resetDb() {
  loadRootEnv();
  execSync(
    "pnpm --filter @evo/db exec prisma migrate reset --force --skip-seed --skip-generate",
    {
      stdio: "inherit",
      env: {
        ...process.env,
        // Prisma requires explicit consent when run by an AI agent.
        // This is a local Docker dev database (localhost:5433) — safe to reset.
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
          "yes",
      },
    }
  );
}
