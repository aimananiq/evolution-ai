import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import FlowCanvas from "./flow-canvas";

export default async function ChatbotFlowPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);

  const instance = await db.instance.findUnique({ where: { id } });
  if (!instance) notFound();

  const chatbot = await db.chatbot.findUnique({
    where: { instanceId: id },
    include: { triggers: { orderBy: { createdAt: "asc" } } },
  });
  const autoresponder = await db.autoresponder.findUnique({ where: { instanceId: id } });

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader icon={Workflow} title={`${t("flow.title")} · ${instance.label}`} />
      <nav className="flex gap-2 border-b pb-2 text-sm">
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}`} className="px-3 py-1 rounded hover:bg-accent">
          {t("automation.chatbot.addTrigger")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/flow`} className="px-3 py-1 rounded bg-card text-foreground">
          {t("flow.tab")}
        </Link>
      </nav>

      {chatbot ? (
        <FlowCanvas
          workspaceSlug={workspaceSlug}
          instanceId={id}
          chatbotId={chatbot.id}
          initial={{
            fallbackProvider: chatbot.fallbackProvider,
            autoresponderEnabled: autoresponder?.enabled ?? false,
            triggers: chatbot.triggers.map((tr) => ({
              id: tr.id,
              keyword: tr.keyword,
              matchType: tr.matchType,
              response: tr.response,
              actionCount: Array.isArray(tr.actions) ? (tr.actions as unknown[]).length : 0,
            })),
          }}
        />
      ) : (
        <EmptyState icon={Workflow} title={t("flow.noChatbot")} />
      )}
    </div>
  );
}
