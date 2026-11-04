/**
 * One-time migration: encrypt plaintext Instance.evolutionApiKey values at rest.
 * Idempotent — rows already tagged with "enc:" are skipped.
 * Run: DATABASE_URL=... ENCRYPTION_KEY=... pnpm --filter @evo/db exec tsx scripts/encrypt-instance-keys.mts
 */
import { prisma } from "../src/index";
import { encryptSecret } from "@evo/crypto";

const rows = await prisma.instance.findMany({ select: { id: true, evolutionApiKey: true } });
let migrated = 0;
for (const row of rows) {
  if (row.evolutionApiKey.startsWith("enc:")) continue;
  await prisma.instance.update({
    where: { id: row.id },
    data: { evolutionApiKey: await encryptSecret(row.evolutionApiKey) },
  });
  migrated += 1;
}
console.log(`encrypted ${migrated}/${rows.length} instance keys`);
await prisma.$disconnect();
