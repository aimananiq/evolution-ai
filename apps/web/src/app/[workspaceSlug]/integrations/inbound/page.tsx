import { getTranslations } from "next-intl/server";
import { Webhook } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import InboundList from "./inbound-list";

export default async function InboundIntegrationsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const [integrations, instances] = await Promise.all([
    db.inboundIntegration.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, enabled: true, lastReceivedAt: true } }),
    db.instance.findMany({ select: { id: true, label: true } }),
  ]);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader icon={Webhook} title={t("inboundIntegrations.title")} />
      <InboundList
        workspaceSlug={workspaceSlug}
        instances={instances}
        initial={integrations.map((i) => ({ id: i.id, name: i.name, enabled: i.enabled, lastReceivedAt: i.lastReceivedAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
