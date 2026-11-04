import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import TopicEditor from "./topic-editor";

export default async function TopicEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const topic = await db.chatTopic.findUnique({ where: { id } });
  if (!topic) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={Bot} title={topic.name} />
      <TopicEditor
        workspaceSlug={workspaceSlug}
        topicId={id}
        initial={{
          name: topic.name,
          personaTone: topic.personaTone,
          greeting: topic.greeting,
          guardrails: topic.guardrails as unknown,
        }}
      />
    </div>
  );
}
