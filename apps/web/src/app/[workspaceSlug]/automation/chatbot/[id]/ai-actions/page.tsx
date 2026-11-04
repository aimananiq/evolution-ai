import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import AiActionsEditor from "./ai-actions-editor";

export default async function AiActionsPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  // id = instanceId (URL convention matches existing chatbot editor page.tsx)
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  // Resolve chatbot by instanceId — same as existing page.tsx
  const chatbot = await db.chatbot.findUnique({ where: { instanceId: id }, include: { aiActionConfig: true } });
  if (!chatbot) notFound();
  const labels = await db.label.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="max-w-2xl space-y-4">
      {/* Tab nav */}
      <nav className="flex gap-2 border-b pb-2 text-sm">
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}`} className="px-3 py-1 rounded hover:bg-accent">
          {t("automation.chatbot.addTrigger")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/ai-actions`} className="px-3 py-1 rounded bg-card text-foreground">
          {t("aiActions.title")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/settings`} className="px-3 py-1 rounded hover:bg-accent">
          {t("aiActions.settings")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/logs`} className="px-3 py-1 rounded hover:bg-accent">
          {t("aiActions.userLogs")}
        </Link>
      </nav>

      <PageHeader icon={Sparkles} title={t("aiActions.title")} />
      {/* Pass chatbot.id (real cuid) — API calls are keyed by chatbot.id, not instanceId */}
      <AiActionsEditor
        workspaceSlug={workspaceSlug}
        chatbotId={chatbot.id}
        labels={labels.map((l) => ({ id: l.id, name: l.name }))}
        initial={chatbot.aiActionConfig ? {
          autoLabel: chatbot.aiActionConfig.autoLabel as any,
          humanTakeover: chatbot.aiActionConfig.humanTakeover as any,
          autoFollowUp: chatbot.aiActionConfig.autoFollowUp as any,
        } : null}
      />
    </div>
  );
}
