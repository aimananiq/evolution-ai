import { Activity } from "lucide-react";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function AdminHealthPage() {
  await requireSuperAdmin();
  const [workspaceCount, userCount, instanceCount, recentMessages, runningWarmers, runningBroadcasts] = await Promise.all([
    prisma.workspace.count(),
    prisma.user.count(),
    prisma.instance.count(),
    prisma.message.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.warmerRun.count({ where: { status: "running" } }),
    prisma.broadcast.count({ where: { status: "running" } }),
  ]);
  const tiles = [
    { label: "Workspaces", value: workspaceCount },
    { label: "Users", value: userCount },
    { label: "Instances", value: instanceCount },
    { label: "Messages last 24h", value: recentMessages },
    { label: "Running warmers", value: runningWarmers },
    { label: "Running broadcasts", value: runningBroadcasts },
  ];
  return (
    <div className="max-w-3xl space-y-3">
      <PageHeader icon={Activity} title="Health" />
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-3 text-center">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-semibold">{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
