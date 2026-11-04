import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { MessageSquareText } from "lucide-react";
import CaptionsForm from "./captions-form";

export default async function CaptionsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Agent");
  const t = await getTranslations("captions");
  const db = tenantClient(workspace.id);
  const items = await db.caption.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={t("title")} description={t("help")} icon={MessageSquareText} />
      <CaptionsForm
        workspaceSlug={workspaceSlug}
        initialItems={items.map((i) => ({ id: i.id, name: i.name, body: i.body }))}
      />
    </div>
  );
}
