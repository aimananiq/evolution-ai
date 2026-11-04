import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Link2 } from "lucide-react";
import LinkGenerator from "./link-generator";

export default async function LinkGeneratorPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("linkGenerator");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({
    select: { id: true, label: true, phoneNumber: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("help")} icon={Link2} />
      <LinkGenerator instances={instances} />
    </div>
  );
}
