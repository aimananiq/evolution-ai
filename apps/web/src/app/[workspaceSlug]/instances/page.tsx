import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Plus } from "lucide-react";
import GroupsPanel from "./groups-panel";

export default async function InstancesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ orderBy: { createdAt: "desc" } });
  const groups = await db.instanceGroup.findMany({
    include: { members: { select: { instanceId: true } } },
    orderBy: { name: "asc" },
  });

  function stateLabel(state: string) {
    const capitalised = state.length > 0 ? state[0]!.toUpperCase() + state.slice(1) : "";
    return t(`instances.state${capitalised}` as any);
  }

  function stateTone(state: string): "success" | "warning" | "danger" | "neutral" {
    if (state === "open") return "success";
    if (state === "connecting") return "warning";
    if (state === "close") return "danger";
    return "neutral";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("instances.title")}
        icon={Smartphone}
        actions={
          <Button asChild>
            <Link href={`/${workspaceSlug}/instances/new`}>
              <Plus />
              {t("instances.new")}
            </Link>
          </Button>
        }
      />
      {instances.length === 0 ? (
        <Card>
          <EmptyState icon={Smartphone} title="—" />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {instances.map((inst) => (
            <div key={inst.id} className="flex items-center justify-between gap-3 p-3">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{inst.label}</strong>
                <StatusPill tone={stateTone(inst.connectionState)}>
                  {stateLabel(inst.connectionState)}
                </StatusPill>
                {inst.phoneNumber && (
                  <span className="text-sm text-muted-foreground">{inst.phoneNumber}</span>
                )}
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${workspaceSlug}/instances/${inst.id}`}>
                  {t("instances.openDetail")}
                </Link>
              </Button>
            </div>
          ))}
        </Card>
      )}
      <GroupsPanel
        workspaceSlug={workspaceSlug}
        instances={instances.map((i) => ({ id: i.id, label: i.label, connectionState: i.connectionState }))}
        initialGroups={groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.members.map((m) => m.instanceId) }))}
      />
    </div>
  );
}
