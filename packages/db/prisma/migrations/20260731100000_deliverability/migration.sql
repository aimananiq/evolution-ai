CREATE TABLE "DeliverabilityProbe" (
    "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "instanceId" TEXT NOT NULL,
    "controlInstanceId" TEXT NOT NULL, "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "receivedAt" TIMESTAMP(3),
    CONSTRAINT "DeliverabilityProbe_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliverabilityProbe_token_key" ON "DeliverabilityProbe"("token");
CREATE INDEX "DeliverabilityProbe_workspaceId_instanceId_sentAt_idx" ON "DeliverabilityProbe"("workspaceId","instanceId","sentAt");
CREATE INDEX "DeliverabilityProbe_status_idx" ON "DeliverabilityProbe"("status");
ALTER TABLE "DeliverabilityProbe" ADD CONSTRAINT "DeliverabilityProbe_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Instance" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Instance" ADD COLUMN "deliveryCheckedAt" TIMESTAMP(3);
ALTER TABLE "Instance" ADD COLUMN "deliveryMissStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Instance" ADD COLUMN "sendFailStreak" INTEGER NOT NULL DEFAULT 0;
