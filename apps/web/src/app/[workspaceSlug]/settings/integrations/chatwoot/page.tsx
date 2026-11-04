import { MessagesSquare } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import ChatwootForm from "./chatwoot-form";

export default async function ChatwootPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ select: { id: true, label: true } });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={MessagesSquare} title="Chatwoot" />
      <ChatwootForm workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
