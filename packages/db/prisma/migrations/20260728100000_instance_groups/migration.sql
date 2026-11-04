-- Instance groups (many-to-many) + broadcast group/rotation fields + per-target sender.
CREATE TABLE "InstanceGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstanceGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstanceGroup_workspaceId_name_key" ON "InstanceGroup"("workspaceId", "name");
CREATE INDEX "InstanceGroup_workspaceId_idx" ON "InstanceGroup"("workspaceId");
ALTER TABLE "InstanceGroup" ADD CONSTRAINT "InstanceGroup_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstanceGroupMember" (
    "groupId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    CONSTRAINT "InstanceGroupMember_pkey" PRIMARY KEY ("groupId", "instanceId")
);
CREATE INDEX "InstanceGroupMember_instanceId_idx" ON "InstanceGroupMember"("instanceId");
ALTER TABLE "InstanceGroupMember" ADD CONSTRAINT "InstanceGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "InstanceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstanceGroupMember" ADD CONSTRAINT "InstanceGroupMember_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Broadcast" ADD COLUMN "instanceGroupId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "groupSendMode" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "rotateEvery" INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN "groupState" JSONB;
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_instanceGroupId_fkey"
    FOREIGN KEY ("instanceGroupId") REFERENCES "InstanceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BroadcastTarget" ADD COLUMN "instanceId" TEXT;
