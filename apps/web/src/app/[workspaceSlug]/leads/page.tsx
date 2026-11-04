import { getTranslations } from "next-intl/server";
import { Filter } from "lucide-react";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import LeadsTable from "./leads-table";

export default async function LeadsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("leads");
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={t("title")} description={t("help")} icon={Filter} />
      <LeadsTable workspaceSlug={workspaceSlug} />
    </div>
  );
}
