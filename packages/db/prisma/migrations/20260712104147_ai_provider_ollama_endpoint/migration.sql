-- AlterEnum
ALTER TYPE "AiProvider" ADD VALUE 'ollama';

-- AlterTable
ALTER TABLE "WorkspaceAiKey" ADD COLUMN     "endpoint" TEXT;
