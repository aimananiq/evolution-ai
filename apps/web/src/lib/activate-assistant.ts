import { tenantClient } from "@evo/db";

const AI_ON = "claude" as const;

export async function activateAssistant(workspaceId: string, topicId: string, instanceId: string) {
  const db = tenantClient(workspaceId);
  return db.chatbot.upsert({
    where: { instanceId },
    create: { instanceId, topicId, enabled: true, fallbackProvider: AI_ON } as any,
    update: { topicId, enabled: true, fallbackProvider: AI_ON } as any,
  });
}

export async function deactivateAssistant(workspaceId: string, topicId: string) {
  const db = tenantClient(workspaceId);
  return db.chatbot.updateMany({ where: { topicId }, data: { enabled: false } });
}
