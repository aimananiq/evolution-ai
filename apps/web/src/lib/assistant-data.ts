import { tenantClient } from "@evo/db";
import { voiceForTone, type VoiceId } from "./assistant";

export type AssistantSummary = {
  id: string;
  name: string;
  voice: VoiceId;
  knowledgeCount: number;
  status: "live" | "draft";
  liveOn: string | null;
};

type TopicRow = {
  id: string; name: string; personaTone: string | null;
  _count: { snippets: number };
  chatbots: { enabled: boolean; fallbackProvider: string; instance: { label: string } | null }[];
};

export function toAssistantSummaries(topics: TopicRow[]): AssistantSummary[] {
  return topics.map((t) => {
    const liveBot = t.chatbots.find((c) => c.enabled && c.fallbackProvider !== "none");
    return {
      id: t.id,
      name: t.name,
      voice: voiceForTone(t.personaTone),
      knowledgeCount: t._count.snippets,
      status: liveBot ? "live" : "draft",
      liveOn: liveBot?.instance?.label ?? null,
    };
  });
}

export async function listAssistants(workspaceId: string): Promise<AssistantSummary[]> {
  const db = tenantClient(workspaceId);
  const topics = await db.chatTopic.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { snippets: true } },
      chatbots: { select: { enabled: true, fallbackProvider: true, instance: { select: { label: true } } } },
    },
  });
  return toAssistantSummaries(topics as unknown as TopicRow[]);
}

export async function connectedInstances(workspaceId: string): Promise<{ id: string; label: string }[]> {
  const db = tenantClient(workspaceId);
  const rows = await db.instance.findMany({
    where: { connectionState: "open" },
    select: { id: true, label: true },
    orderBy: { label: "asc" },
  });
  return rows;
}
