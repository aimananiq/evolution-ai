import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import ExportPanel from "./export-panel";

export default async function ExportParticipantsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("exportParticipants");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({
    select: { id: true, label: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title={t("title")} description={t("help")} icon={Download} />
      <ExportPanel workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
