import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import LogsTable from "./logs-table";

export default async function UserLogsPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  // id = instanceId (URL convention matches existing chatbot editor page.tsx)
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  // Resolve chatbot by instanceId
  const chatbot = await db.chatbot.findUnique({ where: { instanceId: id } });
  if (!chatbot) notFound();

  // Server-render the first page of logs
  const logs = await db.botUserLog.findMany({
    where: { instanceId: chatbot.instanceId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="max-w-2xl space-y-4">
      {/* Tab nav */}
      <nav className="flex gap-2 border-b pb-2 text-sm">
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}`} className="px-3 py-1 rounded hover:bg-accent">
          {t("automation.chatbot.addTrigger")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/ai-actions`} className="px-3 py-1 rounded hover:bg-accent">
          {t("aiActions.title")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/settings`} className="px-3 py-1 rounded hover:bg-accent">
          {t("aiActions.settings")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/logs`} className="px-3 py-1 rounded bg-card text-foreground">
          {t("aiActions.userLogs")}
        </Link>
      </nav>

      <PageHeader icon={ScrollText} title={t("aiActions.userLogs")} />
      {/* Pass chatbot.id (real cuid) — API calls use /chatbots/[chatbotId]/logs */}
      <LogsTable
        workspaceSlug={workspaceSlug}
        chatbotId={chatbot.id}
        initialLogs={logs.map((l) => ({
          id: l.id,
          kind: l.kind,
          detail: l.detail,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
