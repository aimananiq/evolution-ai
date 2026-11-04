import { getTranslations } from "next-intl/server";
import { Zap } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import QuickRepliesForm from "./quick-replies-form";

export default async function QuickRepliesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const items = await db.quickReply.findMany({ orderBy: { shortcut: "asc" } });
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader icon={Zap} title={t("quickReplies.title")} />
      <QuickRepliesForm workspaceSlug={workspaceSlug} initialItems={items.map(i => ({ id: i.id, shortcut: i.shortcut, body: i.body }))} />
    </div>
  );
}
