-- CreateTable
CREATE TABLE "Caption" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Caption_workspaceId_idx" ON "Caption"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Caption_workspaceId_name_key" ON "Caption"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "Caption" ADD CONSTRAINT "Caption_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
