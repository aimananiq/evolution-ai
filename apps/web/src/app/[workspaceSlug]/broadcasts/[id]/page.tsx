import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import DetailView from "./detail-view";

export default async function BroadcastDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const broadcast = await db.broadcast.findUnique({
    where: { id },
    include: { list: { select: { name: true } }, template: { select: { name: true, body: true } }, instance: { select: { label: true } } },
  });
  if (!broadcast) notFound();

  return (
    <DetailView
      workspaceSlug={workspaceSlug}
      broadcastId={id}
      initial={{
        name: broadcast.name,
        status: broadcast.status,
        listName: broadcast.list?.name ?? "?",
        instanceLabel: broadcast.instance?.label ?? "?",
        templateName: broadcast.template?.name ?? null,
        scheduledAt: broadcast.scheduledAt?.toISOString() ?? null,
      }}
    />
  );
}
