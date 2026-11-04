-- CreateEnum
CREATE TYPE "AudienceScope" AS ENUM ('all', 'individual', 'group');

-- CreateTable
CREATE TABLE "Autoresponder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendTo" "AudienceScope" NOT NULL DEFAULT 'all',
    "text" TEXT,
    "mediaAssetId" TEXT,
    "caption" TEXT,
    "rejectCall" BOOLEAN NOT NULL DEFAULT false,
    "msgCall" TEXT,
    "pausePerCustomerSec" INTEGER NOT NULL DEFAULT 60,
    "scheduleJson" JSONB,
    "excludeContactListIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Autoresponder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Autoresponder_instanceId_key" ON "Autoresponder"("instanceId");

-- CreateIndex
CREATE INDEX "Autoresponder_workspaceId_idx" ON "Autoresponder"("workspaceId");

-- AddForeignKey
ALTER TABLE "Autoresponder" ADD CONSTRAINT "Autoresponder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Autoresponder" ADD CONSTRAINT "Autoresponder_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
