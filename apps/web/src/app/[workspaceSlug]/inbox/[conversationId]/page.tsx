import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import ChatPane from "./chat-pane";
import Sidebar from "./sidebar";

export default async function ConversationPage({
  params,
}: { params: Promise<{ workspaceSlug: string; conversationId: string }> }) {
  const { workspaceSlug, conversationId } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Agent");
  const db = tenantClient(workspace.id);
  const conv = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) notFound();
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  await db.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });

  return (
    <div className="flex h-[calc(100vh-2rem)]">
      <ChatPane
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        contactLabel={conv.contactName ?? conv.contactPhone}
        initialMessages={messages.reverse().map((m) => ({
          id: m.id, direction: m.direction, body: m.body, sentAt: m.sentAt.toISOString(), status: m.status,
        }))}
      />
      <Sidebar
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        currentStatus={conv.status}
        assignedToUserId={conv.assignedToUserId}
      />
    </div>
  );
}
