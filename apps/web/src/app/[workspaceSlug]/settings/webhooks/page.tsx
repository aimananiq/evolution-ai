import { Webhook } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import WebhooksForm from "./webhooks-form";

export default async function WebhooksPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const subs = await db.webhookSubscription.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, events: true, enabled: true, createdAt: true },
  });
  const logs = await db.webhookDeliveryLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, event: true, url: true, ok: true, statusCode: true, error: true, createdAt: true },
  });
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader icon={Webhook} title={t("webhooks.title")} description={t("webhooks.help")} />
      <WebhooksForm
        workspaceSlug={workspaceSlug}
        initial={subs.map((s) => ({
          ...s,
          events: s.events as string[],
          createdAt: s.createdAt.toISOString(),
        }))}
        logs={logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
      />
    </div>
  );
}
