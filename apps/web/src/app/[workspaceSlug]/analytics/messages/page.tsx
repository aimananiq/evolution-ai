import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import MessagesChart from "./messages-chart";

export default async function MessagesAnalyticsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const messages = await db.message.findMany({
    where: { sentAt: { gte: since } },
    select: { sentAt: true, direction: true },
    take: 10000,
  });
  const buckets = new Map<string, { date: string; inbound: number; outbound: number }>();
  for (const m of messages) {
    const day = m.sentAt.toISOString().slice(0, 10);
    const b = buckets.get(day) ?? { date: day, inbound: 0, outbound: 0 };
    if (m.direction === "inbound") b.inbound++; else b.outbound++;
    buckets.set(day, b);
  }
  const data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  return <MessagesChart data={data} />;
}
