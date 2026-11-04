-- DropIndex
DROP INDEX "WarmerTemplate_workspaceId_idx";

-- AlterTable
ALTER TABLE "WarmerTemplate" ADD COLUMN     "warmerProfileId" TEXT;

-- CreateIndex
CREATE INDEX "WarmerTemplate_workspaceId_warmerProfileId_idx" ON "WarmerTemplate"("workspaceId", "warmerProfileId");

-- AddForeignKey
ALTER TABLE "WarmerTemplate" ADD CONSTRAINT "WarmerTemplate_warmerProfileId_fkey" FOREIGN KEY ("warmerProfileId") REFERENCES "WarmerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
