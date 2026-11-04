import { redis } from "@evo/queue";

export async function publishEvent(workspaceId: string, payload: unknown): Promise<void> {
  const channel = `events:${workspaceId}`;
  await redis().publish(channel, JSON.stringify(payload));
}
