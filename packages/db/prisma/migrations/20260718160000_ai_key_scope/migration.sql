-- Per-feature AI config: add a `scope` and key WorkspaceAiKey by (workspaceId, scope).
-- Existing rows become the "default" scope.
ALTER TABLE "WorkspaceAiKey" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "WorkspaceAiKey" DROP CONSTRAINT "WorkspaceAiKey_pkey";
ALTER TABLE "WorkspaceAiKey" ADD CONSTRAINT "WorkspaceAiKey_pkey" PRIMARY KEY ("workspaceId", "scope");
