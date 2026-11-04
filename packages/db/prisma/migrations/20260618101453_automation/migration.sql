-- CreateEnum
CREATE TYPE "ChatbotFallbackProvider" AS ENUM ('none', 'claude', 'openai');

-- CreateEnum
CREATE TYPE "KeywordMatchType" AS ENUM ('exact', 'contains', 'startsWith');

-- CreateEnum
CREATE TYPE "DripTriggerType" AS ENUM ('manual', 'newContact');

-- CreateEnum
CREATE TYPE "DripEnrolmentStatus" AS ENUM ('active', 'completed', 'paused', 'failed');

-- CreateTable
CREATE TABLE "Chatbot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeMessage" TEXT,
    "fallbackProvider" "ChatbotFallbackProvider" NOT NULL DEFAULT 'none',
    "fallbackModel" TEXT,
    "systemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chatbot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordTrigger" (
    "id" TEXT NOT NULL,
    "chatbotId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "matchType" "KeywordMatchType" NOT NULL DEFAULT 'contains',
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DripCampaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "DripTriggerType" NOT NULL DEFAULT 'manual',
    "steps" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DripCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DripEnrolment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" "DripEnrolmentStatus" NOT NULL DEFAULT 'active',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DripEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chatbot_instanceId_key" ON "Chatbot"("instanceId");

-- CreateIndex
CREATE INDEX "Chatbot_workspaceId_idx" ON "Chatbot"("workspaceId");

-- CreateIndex
CREATE INDEX "KeywordTrigger_chatbotId_idx" ON "KeywordTrigger"("chatbotId");

-- CreateIndex
CREATE INDEX "DripCampaign_workspaceId_active_idx" ON "DripCampaign"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "DripEnrolment_workspaceId_status_nextRunAt_idx" ON "DripEnrolment"("workspaceId", "status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "DripEnrolment_campaignId_contactId_key" ON "DripEnrolment"("campaignId", "contactId");

-- AddForeignKey
ALTER TABLE "Chatbot" ADD CONSTRAINT "Chatbot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chatbot" ADD CONSTRAINT "Chatbot_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordTrigger" ADD CONSTRAINT "KeywordTrigger_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripCampaign" ADD CONSTRAINT "DripCampaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripCampaign" ADD CONSTRAINT "DripCampaign_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrolment" ADD CONSTRAINT "DripEnrolment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrolment" ADD CONSTRAINT "DripEnrolment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "DripCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrolment" ADD CONSTRAINT "DripEnrolment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
