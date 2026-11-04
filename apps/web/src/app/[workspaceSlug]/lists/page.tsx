import { getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import ListsPanel from "./lists-panel";

export default async function ListsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("lists");
  const db = tenantClient(workspace.id);
  const lists = await db.contactList.findMany({
    include: { _count: { select: { members: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={t("title")} icon={ListChecks} />
      <ListsPanel workspaceSlug={workspaceSlug} initialLists={lists} />
    </div>
  );
}
