import { getTranslations } from "next-intl/server";
import { Upload } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import ImportWizard from "./import-wizard";

export default async function ImportPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ select: { id: true, label: true } });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t("contacts.importWizard.title")} icon={Upload} />
      <ImportWizard workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
