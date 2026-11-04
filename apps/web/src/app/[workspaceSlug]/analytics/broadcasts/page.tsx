import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import BroadcastsChart from "./broadcasts-chart";

export default async function BroadcastsAnalyticsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const counts = await db.broadcastTarget.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const data = ["queued", "sending", "sent", "delivered", "read", "failed"].map((status) => ({
    status,
    count: counts.find((c) => c.status === status)?._count._all ?? 0,
  }));
  return <BroadcastsChart data={data} />;
}
