import { getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { EmptyState } from "@/components/ui/empty-state";
import ConversationList from "./conversation-list";

export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, userId } = await requireMember(workspaceSlug, "Agent");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const conversations = await db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex h-full">
      <ConversationList
        workspaceSlug={workspaceSlug}
        currentUserId={userId}
        initial={conversations.map((c) => ({
          id: c.id, contactPhone: c.contactPhone, contactName: c.contactName,
          lastMessageAt: c.lastMessageAt.toISOString(), unreadCount: c.unreadCount,
          status: c.status, assignedToUserId: c.assignedToUserId,
        }))}
      />
      <main className="flex flex-1 items-center justify-center bg-background">
        <EmptyState icon={MessageSquare} title={t("inbox.emptyChat")} />
      </main>
    </div>
  );
}
