import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import InboundEditor from "./editor";

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export default async function InboundEditorPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const db = tenantClient(workspace.id);
  const [row, instances] = await Promise.all([
    db.inboundIntegration.findUnique({ where: { id } }),
    db.instance.findMany({ select: { id: true, label: true } }),
  ]);
  if (!row) notFound();
  return (
    <InboundEditor
      workspaceSlug={workspaceSlug}
      instances={instances}
      initial={{
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        instanceId: row.instanceId,
        enabled: row.enabled,
        recipientPathKey: row.recipientPathKey,
        captionTemplate: row.captionTemplate,
        webhookUrl: `${baseUrl()}/integration_webhook/${row.token}`,
        lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
      }}
    />
  );
}
