CREATE TABLE "ChatTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personaTone" TEXT,
    "greeting" TEXT,
    "guardrails" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatTopic_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatTopic_workspaceId_idx" ON "ChatTopic"("workspaceId");
CREATE UNIQUE INDEX "ChatTopic_workspaceId_name_key" ON "ChatTopic"("workspaceId", "name");
ALTER TABLE "ChatTopic" ADD CONSTRAINT "ChatTopic_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeSnippet" ADD COLUMN "topicId" TEXT;
ALTER TABLE "KnowledgeSnippet" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'faq';
ALTER TABLE "KnowledgeSnippet" ADD COLUMN "sourceLabel" TEXT;
CREATE INDEX "KnowledgeSnippet_topicId_idx" ON "KnowledgeSnippet"("topicId");
ALTER TABLE "KnowledgeSnippet" ADD CONSTRAINT "KnowledgeSnippet_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ChatTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Chatbot" ADD COLUMN "topicId" TEXT;
ALTER TABLE "Chatbot" ADD CONSTRAINT "Chatbot_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "ChatTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
