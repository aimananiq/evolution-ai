import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import SettingsEditor from "./settings-editor";

export default async function ChatbotSettingsPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  // id = instanceId (URL convention matches existing chatbot editor page.tsx)
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  // Resolve chatbot by instanceId
  const chatbot = await db.chatbot.findUnique({ where: { instanceId: id } });
  if (!chatbot) notFound();

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
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/settings`} className="px-3 py-1 rounded bg-card text-foreground">
          {t("aiActions.settings")}
        </Link>
        <Link href={`/${workspaceSlug}/automation/chatbot/${id}/logs`} className="px-3 py-1 rounded hover:bg-accent">
          {t("aiActions.userLogs")}
        </Link>
      </nav>

      <PageHeader icon={Settings} title={t("aiActions.settings")} />
      {/* Pass chatbot.id (real cuid) — API calls PUT to /chatbots/[chatbotId] */}
      <SettingsEditor
        workspaceSlug={workspaceSlug}
        chatbotId={chatbot.id}
        initial={{
          pauseBot: chatbot.pauseBot,
          unsubscribeKeyword: chatbot.unsubscribeKeyword ?? "",
          scheduleJson: chatbot.scheduleJson ? JSON.stringify(chatbot.scheduleJson, null, 2) : "",
          limiterJson: chatbot.limiterJson ? JSON.stringify(chatbot.limiterJson, null, 2) : "",
          filterJson: chatbot.filterJson ? JSON.stringify(chatbot.filterJson, null, 2) : "",
          fallbackProvider: chatbot.fallbackProvider as "none" | "claude" | "openai",
          fallbackModel: chatbot.fallbackModel ?? "",
          aiTemperature: chatbot.aiTemperature ?? null,
          aiContextLength: chatbot.aiContextLength ?? null,
        }}
      />
    </div>
  );
}
