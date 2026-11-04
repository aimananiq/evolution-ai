import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import { parseActions } from "@evo/flow-actions";
import Link from "next/link";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import Editor from "./editor";

export default async function ChatbotEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
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

  const labels = await db.label.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const lists = await db.contactList.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={Bot} title={`${t("automation.chatbot.title")} · ${instance.label}`} />

      {/* Tab nav — Rules / AI Actions / Settings / User Logs */}
      {chatbot && (
        <nav className="flex gap-2 border-b pb-2 text-sm">
          <Link href={`/${workspaceSlug}/automation/chatbot/${id}`} className="px-3 py-1 rounded bg-card text-foreground">
            {t("automation.chatbot.addTrigger")}
          </Link>
          <Link href={`/${workspaceSlug}/automation/chatbot/${id}/flow`} className="px-3 py-1 rounded hover:bg-accent">
            {t("flow.tab")}
          </Link>
          <Link href={`/${workspaceSlug}/automation/chatbot/${id}/ai-actions`} className="px-3 py-1 rounded hover:bg-accent">
            {t("aiActions.title")}
          </Link>
          <Link href={`/${workspaceSlug}/automation/chatbot/${id}/settings`} className="px-3 py-1 rounded hover:bg-accent">
            {t("aiActions.settings")}
          </Link>
          <Link href={`/${workspaceSlug}/automation/chatbot/${id}/logs`} className="px-3 py-1 rounded hover:bg-accent">
            {t("aiActions.userLogs")}
          </Link>
        </nav>
      )}
      <Editor
        workspaceSlug={workspaceSlug}
        instanceId={id}
        labels={labels}
        lists={lists}
        initial={chatbot ? {
          id: chatbot.id,
          enabled: chatbot.enabled,
          welcomeMessage: chatbot.welcomeMessage,
          fallbackProvider: chatbot.fallbackProvider,
          fallbackModel: chatbot.fallbackModel,
          systemPrompt: chatbot.systemPrompt,
          topicId: chatbot.topicId ?? null,
          triggers: chatbot.triggers.map((tr) => ({
            id: tr.id,
            keyword: tr.keyword,
            matchType: tr.matchType,
            response: tr.response,
            name: tr.name ?? null,
            description: tr.description ?? null,
            sendTo: tr.sendTo,
            isDefaultReply: tr.isDefaultReply,
            presenceDelaySec: tr.presenceDelaySec,
            mediaAssetId: tr.mediaAssetId ?? null,
            actions: (() => { try { return parseActions(tr.actions); } catch { return []; } })(),
          })),
        } : null}
      />
    </div>
  );
}
