import { getTranslations } from "next-intl/server";
import { Send } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import Wizard from "./wizard";

export default async function NewDripPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const [instances, templates] = await Promise.all([
    db.instance.findMany({ select: { id: true, label: true } }),
    db.messageTemplate.findMany({ select: { id: true, name: true } }),
  ]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader icon={Send} title={t("automation.drip.newCampaign")} />
      <Wizard workspaceSlug={workspaceSlug} instances={instances} templates={templates} />
    </div>
  );
}
