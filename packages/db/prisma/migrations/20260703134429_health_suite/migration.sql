-- CreateEnum
CREATE TYPE "HealthRisk" AS ENUM ('healthy', 'caution', 'at_risk');

-- CreateEnum
CREATE TYPE "HealthAlertKind" AS ENUM ('went_at_risk', 'auto_protected', 'ramp_cap_reached');

-- CreateTable
CREATE TABLE "InstanceHealthPolicy" (
    "instanceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rampEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rampStartedAt" TIMESTAMP(3),
    "rampBaseDaily" INTEGER NOT NULL DEFAULT 20,
    "rampGrowthPct" INTEGER NOT NULL DEFAULT 15,
    "rampMaxDaily" INTEGER NOT NULL DEFAULT 500,
    "autoProtect" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceHealthPolicy_pkey" PRIMARY KEY ("instanceId")
);

-- CreateTable
CREATE TABLE "InstanceHealthSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "risk" "HealthRisk" NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthAlert" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "kind" "HealthAlertKind" NOT NULL,
    "detail" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstanceHealthPolicy_workspaceId_idx" ON "InstanceHealthPolicy"("workspaceId");

-- CreateIndex
CREATE INDEX "InstanceHealthSnapshot_workspaceId_date_idx" ON "InstanceHealthSnapshot"("workspaceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceHealthSnapshot_instanceId_date_key" ON "InstanceHealthSnapshot"("instanceId", "date");

-- CreateIndex
CREATE INDEX "HealthAlert_workspaceId_createdAt_idx" ON "HealthAlert"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthAlert_instanceId_createdAt_idx" ON "HealthAlert"("instanceId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstanceHealthPolicy" ADD CONSTRAINT "InstanceHealthPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceHealthPolicy" ADD CONSTRAINT "InstanceHealthPolicy_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceHealthSnapshot" ADD CONSTRAINT "InstanceHealthSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceHealthSnapshot" ADD CONSTRAINT "InstanceHealthSnapshot_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAlert" ADD CONSTRAINT "HealthAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthAlert" ADD CONSTRAINT "HealthAlert_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
