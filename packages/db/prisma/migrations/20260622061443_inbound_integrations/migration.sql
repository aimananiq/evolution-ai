-- CreateEnum
CREATE TYPE "InboundLogStatus" AS ENUM ('received', 'sent', 'failed', 'no_recipient');

-- CreateTable
CREATE TABLE "InboundIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipientPathKey" TEXT NOT NULL,
    "captionTemplate" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "captureArmed" BOOLEAN NOT NULL DEFAULT false,
    "lastReceivedAt" TIMESTAMP(3),
    "lastSamplePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundIntegrationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "resolvedPhone" TEXT,
    "status" "InboundLogStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundIntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundIntegration_token_key" ON "InboundIntegration"("token");

-- CreateIndex
CREATE INDEX "InboundIntegration_workspaceId_createdAt_idx" ON "InboundIntegration"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundIntegration_instanceId_idx" ON "InboundIntegration"("instanceId");

-- CreateIndex
CREATE INDEX "InboundIntegrationLog_integrationId_createdAt_idx" ON "InboundIntegrationLog"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundIntegrationLog_workspaceId_createdAt_idx" ON "InboundIntegrationLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "InboundIntegration" ADD CONSTRAINT "InboundIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundIntegration" ADD CONSTRAINT "InboundIntegration_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundIntegrationLog" ADD CONSTRAINT "InboundIntegrationLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundIntegrationLog" ADD CONSTRAINT "InboundIntegrationLog_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "InboundIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
