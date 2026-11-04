import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function startOfMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default async function AdminDashboard() {
  await requireSuperAdmin();
  const [
    workspaceCount,
    userCount,
    instanceTotal,
    instanceOpen,
    msgsThisMonth,
    msgs24h,
    runningWarmers,
    runningBroadcasts,
    plans,
    recentWorkspaces,
  ] = await Promise.all([
    prisma.workspace.count(),
    prisma.user.count(),
    prisma.instance.count(),
    prisma.instance.count({ where: { connectionState: "open" } }),
    prisma.message.count({ where: { sentAt: { gte: startOfMonth() } } }),
    prisma.message.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.warmerRun.count({ where: { status: "running" } }),
    prisma.broadcast.count({ where: { status: "running" } }),
    prisma.plan.findMany({ select: { kind: true, name: true, _count: { select: { workspaces: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.workspace.findMany({
      select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { members: true, instances: true } }, plan: { select: { plan: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  const tiles = [
    { label: "Tenants", value: workspaceCount, href: "/admin/workspaces" },
    { label: "Users", value: userCount, href: "/admin/users" },
    { label: "Numbers (connected)", value: `${instanceOpen}/${instanceTotal}` },
    { label: "Messages this month", value: msgsThisMonth.toLocaleString() },
    { label: "Messages 24h", value: msgs24h.toLocaleString() },
    { label: "Warmers running", value: runningWarmers },
    { label: "Broadcasts running", value: runningBroadcasts },
    { label: "Plans", value: plans.length, href: "/admin/plans" },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader icon={LayoutDashboard} title="Overview" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const inner = (
            <Card className="h-full transition-colors hover:bg-accent/40">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{t.label}</div>
                <div className="text-2xl font-semibold mt-1">{t.value}</div>
              </CardContent>
            </Card>
          );
          return t.href ? <Link key={t.label} href={t.href}>{inner}</Link> : <div key={t.label}>{inner}</div>;
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Plan distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y border-t">
              {plans.map((p) => (
                <div key={p.kind} className="flex items-center justify-between p-3 text-sm">
                  <span><span className="text-xs uppercase bg-muted px-2 py-0.5 rounded mr-2">{p.kind}</span>{p.name}</span>
                  <span className="font-medium">{p._count.workspaces} tenant{p._count.workspaces === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Newest tenants</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y border-t">
              {recentWorkspaces.map((w) => (
                <div key={w.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{w.name}</div>
                    <div className="text-xs text-muted-foreground">{w.plan?.plan?.name ?? "—"} · {w._count.members} member{w._count.members === 1 ? "" : "s"} · {w._count.instances} number{w._count.instances === 1 ? "" : "s"}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{w.createdAt.toLocaleDateString("en-GB")}</span>
                </div>
              ))}
              {recentWorkspaces.length === 0 && <div className="p-3 text-sm text-muted-foreground">No tenants yet.</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
