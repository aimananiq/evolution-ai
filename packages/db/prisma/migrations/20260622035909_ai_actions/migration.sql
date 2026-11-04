/*
  Warnings:

  - A unique constraint covering the columns `[workspaceId,name]` on the table `DripCampaign` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BotNotifyType" AS ENUM ('whatsapp_number', 'whatsapp_group');

-- CreateEnum
CREATE TYPE "FollowUpLastSender" AS ENUM ('chatbot', 'customer');

-- CreateEnum
CREATE TYPE "BotUserLogKind" AS ENUM ('trigger_matched', 'ai_reply', 'auto_label', 'human_takeover', 'follow_up_sent', 'action_run');

-- AlterTable
ALTER TABLE "Chatbot" ADD COLUMN     "aiContextLength" INTEGER,
ADD COLUMN     "aiTemperature" DOUBLE PRECISION,
ADD COLUMN     "filterJson" JSONB,
ADD COLUMN     "limiterJson" JSONB,
ADD COLUMN     "pauseBot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduleJson" JSONB,
ADD COLUMN     "unsubscribeKeyword" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "botPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botPausedReason" TEXT;

-- CreateTable
CREATE TABLE "AiActionConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "autoLabel" JSONB NOT NULL DEFAULT '{"enabled":false,"rules":[]}',
    "humanTakeover" JSONB NOT NULL DEFAULT '{"enabled":false}',
    "autoFollowUp" JSONB NOT NULL DEFAULT '{"enabled":false,"steps":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiActionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotUserLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "instanceId" TEXT NOT NULL,
    "kind" "BotUserLogKind" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotUserLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiActionConfig_chatbotId_key" ON "AiActionConfig"("chatbotId");

-- CreateIndex
CREATE INDEX "AiActionConfig_workspaceId_idx" ON "AiActionConfig"("workspaceId");

-- CreateIndex
CREATE INDEX "BotUserLog_workspaceId_createdAt_idx" ON "BotUserLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BotUserLog_conversationId_createdAt_idx" ON "BotUserLog"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "BotUserLog_instanceId_createdAt_idx" ON "BotUserLog"("instanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DripCampaign_workspaceId_name_key" ON "DripCampaign"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "AiActionConfig" ADD CONSTRAINT "AiActionConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionConfig" ADD CONSTRAINT "AiActionConfig_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotUserLog" ADD CONSTRAINT "BotUserLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
