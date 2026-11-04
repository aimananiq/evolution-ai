import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { MessageSquare, Users, CheckCheck, Smartphone, LineChart, Inbox } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActivityChart } from "@/components/dashboard/activity-chart";

const DAY_MS = 86_400_000;

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}

export default async function DashboardPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [sentThisWeek, sentLastWeek, contacts, instancesOpen, instancesTotal, outboundStatuses, recent] =
    await Promise.all([
      db.message.count({ where: { direction: "outbound", sentAt: { gte: weekAgo } } }),
      db.message.count({ where: { direction: "outbound", sentAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      db.contact.count(),
      db.instance.count({ where: { connectionState: "open" } }),
      db.instance.count(),
      db.message.groupBy({
        by: ["status"],
        where: { direction: "outbound", sentAt: { gte: weekAgo } },
        _count: { _all: true },
      }),
      db.conversation.findMany({
        orderBy: { lastMessageAt: "desc" },
        take: 5,
        select: { id: true, contactName: true, contactPhone: true, lastMessageAt: true },
      }),
    ]);

  // Delivery rate: delivered/read over all resolved outbound messages this week.
  const byStatus = Object.fromEntries(outboundStatuses.map((s) => [s.status, s._count._all])) as Record<string, number>;
  const delivered = (byStatus.delivered ?? 0) + (byStatus.read ?? 0);
  const resolved = delivered + (byStatus.sent ?? 0) + (byStatus.failed ?? 0);
  const deliveryRate = resolved > 0 ? `${((delivered / resolved) * 100).toFixed(1)}%` : "—";

  const delta =
    sentLastWeek > 0
      ? {
          value: `${Math.abs(Math.round(((sentThisWeek - sentLastWeek) / sentLastWeek) * 100))}%`,
          positive: sentThisWeek >= sentLastWeek,
        }
      : undefined;

  // Messages per day, last 7 days (inbound + outbound = activity).
  const chart = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const start = new Date(now.getTime() - (6 - i) * DAY_MS);
      const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      return db.message
        .count({ where: { sentAt: { gte: dayStart, lt: dayEnd } } })
        .then((value) => ({ label: dayLabel(dayStart), value }));
    }),
  );

  const chartTotal = chart.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.welcome", { workspace: workspace.name })} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("dashboard.statMessages")} value={sentThisWeek.toLocaleString("en-GB")} delta={delta} icon={MessageSquare} />
        <StatCard label={t("dashboard.statContacts")} value={contacts.toLocaleString("en-GB")} icon={Users} />
        <StatCard label={t("dashboard.statDelivery")} value={deliveryRate} icon={CheckCheck} />
        <StatCard label={t("dashboard.statInstances")} value={`${instancesOpen}/${instancesTotal}`} icon={Smartphone} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t("dashboard.activityTitle")}</CardTitle></CardHeader>
          <CardContent>
            {chartTotal === 0 ? (
              <EmptyState icon={LineChart} title={t("dashboard.activityEmpty")} description={t("dashboard.activityEmptyHint")} />
            ) : (
              <ActivityChart data={chart} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("dashboard.recentTitle")}</CardTitle></CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState icon={Inbox} title={t("dashboard.recentEmpty")} description={t("dashboard.recentEmptyHint")} />
            ) : (
              <ul className="space-y-2">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link href={`/${workspaceSlug}/inbox/${c.id}`} className="block rounded p-2 -m-2 hover:bg-accent">
                      <div className="text-sm font-medium">{c.contactName ?? c.contactPhone}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.lastMessageAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
