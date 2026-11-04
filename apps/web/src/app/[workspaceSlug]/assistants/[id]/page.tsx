import { notFound } from "next/navigation";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { connectedInstances } from "@/lib/assistant-data";
import { AssistantHome } from "./assistant-home";

export default async function AssistantHomePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");

  const topic = await tenantClient(workspace.id).chatTopic.findUnique({
    where: { id },
    include: {
      chatbots: {
        select: {
          id: true,
          enabled: true,
          fallbackProvider: true,
          instanceId: true,
          instance: { select: { label: true } },
        },
      },
      _count: { select: { snippets: true } },
    },
  });

  if (!topic) notFound();

  const liveBot = topic.chatbots.find((c) => c.enabled && c.fallbackProvider !== "none");
  const live = Boolean(liveBot);
  const liveOn = liveBot?.instance?.label ?? null;
  const liveChatbotId = liveBot?.id ?? null;
  const liveInstanceId = liveBot?.instanceId ?? null;

  const instances = await connectedInstances(workspace.id);

  return (
    <AssistantHome
      workspaceSlug={workspaceSlug}
      topic={{
        id: topic.id,
        name: topic.name,
        personaTone: topic.personaTone,
        greeting: topic.greeting,
        guardrails: topic.guardrails,
      }}
      knowledgeCount={topic._count.snippets}
      live={live}
      liveOn={liveOn}
      liveChatbotId={liveChatbotId}
      liveInstanceId={liveInstanceId}
      instances={instances}
    />
  );
}
