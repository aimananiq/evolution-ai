import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { Card } from "@/components/ui/card";

const SENT_STATUSES = ["sent", "delivered", "read"];

export default async function LeaderboardPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("analytics");
  const db = tenantClient(workspace.id);

  const [grouped, broadcasts] = await Promise.all([
    db.broadcastTarget.groupBy({ by: ["broadcastId", "status"], _count: { _all: true } }),
    db.broadcast.findMany({ select: { id: true, name: true, instance: { select: { label: true } } } }),
  ]);

  const byId = new Map(broadcasts.map((b) => [b.id, b]));
  const agg = new Map<string, { sent: number; failed: number; total: number }>();
  for (const g of grouped) {
    const row = agg.get(g.broadcastId) ?? { sent: 0, failed: 0, total: 0 };
    const n = g._count._all;
    row.total += n;
    if (SENT_STATUSES.includes(g.status)) row.sent += n;
    if (g.status === "failed") row.failed += n;
    agg.set(g.broadcastId, row);
  }

  const rows = [...agg.entries()]
    .map(([id, v]) => ({
      name: byId.get(id)?.name ?? "—",
      instance: byId.get(id)?.instance?.label ?? "—",
      ...v,
      rate: v.total > 0 ? Math.round((v.sent / v.total) * 100) : 0,
    }))
    .sort((a, b) => b.sent - a.sent);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("leaderboard.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("leaderboard.help")}</p>
      </div>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr className="text-left">
              <th className="p-3 font-medium">{t("leaderboard.rank")}</th>
              <th className="p-3 font-medium">{t("leaderboard.campaign")}</th>
              <th className="p-3 font-medium">{t("leaderboard.instance")}</th>
              <th className="p-3 font-medium text-right">{t("leaderboard.sent")}</th>
              <th className="p-3 font-medium text-right">{t("leaderboard.failed")}</th>
              <th className="p-3 font-medium text-right">{t("leaderboard.rate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-secondary/30">
                <td className="p-3 font-medium">{i + 1}</td>
                <td className="p-3">{r.name}</td>
                <td className="p-3 text-muted-foreground">{r.instance}</td>
                <td className="p-3 text-right tabular-nums">{r.sent}</td>
                <td className="p-3 text-right tabular-nums text-destructive">{r.failed}</td>
                <td className="p-3 text-right tabular-nums">{r.rate}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{t("leaderboard.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
