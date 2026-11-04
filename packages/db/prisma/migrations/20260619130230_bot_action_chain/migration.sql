-- CreateEnum
CREATE TYPE "TriggerAudience" AS ENUM ('all', 'individual', 'group');

-- CreateEnum
CREATE TYPE "BotPendingKind" AS ENUM ('save_response', 'next_action');

-- AlterTable
ALTER TABLE "KeywordTrigger" ADD COLUMN     "actions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDefaultReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaAssetId" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "presenceDelaySec" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sendTo" "TriggerAudience" NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE "BotPendingState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "kind" "BotPendingKind" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotPendingState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotPendingState_workspaceId_expiresAt_idx" ON "BotPendingState"("workspaceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotPendingState_conversationId_key" ON "BotPendingState"("conversationId");

-- AddForeignKey
ALTER TABLE "BotPendingState" ADD CONSTRAINT "BotPendingState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
