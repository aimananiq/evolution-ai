-- CreateEnum
CREATE TYPE "WarmerMode" AS ENUM ('internal', 'pair');

-- CreateEnum
CREATE TYPE "WarmerRunStatus" AS ENUM ('starting', 'running', 'paused', 'stopped', 'failed');

-- CreateEnum
CREATE TYPE "WarmerEventKind" AS ENUM ('send', 'presence', 'reaction', 'health', 'error', 'info');

-- CreateTable
CREATE TABLE "WarmerProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmerTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmerPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmerPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmerRun" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "WarmerRunStatus" NOT NULL DEFAULT 'starting',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "WarmerRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmerEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "instanceId" TEXT,
    "kind" "WarmerEventKind" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarmerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarmerProfile_workspaceId_enabled_idx" ON "WarmerProfile"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "WarmerProfile_workspaceId_name_key" ON "WarmerProfile"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WarmerTemplate_workspaceId_idx" ON "WarmerTemplate"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WarmerPreset_name_key" ON "WarmerPreset"("name");

-- CreateIndex
CREATE INDEX "WarmerRun_workspaceId_status_idx" ON "WarmerRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WarmerRun_profileId_startedAt_idx" ON "WarmerRun"("profileId", "startedAt");

-- CreateIndex
CREATE INDEX "WarmerEvent_runId_createdAt_idx" ON "WarmerEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "WarmerEvent_workspaceId_createdAt_idx" ON "WarmerEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "WarmerProfile" ADD CONSTRAINT "WarmerProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmerTemplate" ADD CONSTRAINT "WarmerTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmerRun" ADD CONSTRAINT "WarmerRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "WarmerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmerRun" ADD CONSTRAINT "WarmerRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmerEvent" ADD CONSTRAINT "WarmerEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmerEvent" ADD CONSTRAINT "WarmerEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WarmerRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
