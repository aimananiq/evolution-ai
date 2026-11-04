import { getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import Wizard from "./wizard";

export default async function NewBroadcastPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const [instances, lists, templates, groups] = await Promise.all([
    db.instance.findMany({ select: { id: true, label: true } }),
    db.contactList.findMany({ select: { id: true, name: true, _count: { select: { members: true } } } }),
    db.messageTemplate.findMany({ select: { id: true, name: true } }),
    db.instanceGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t("broadcasts.new")} icon={Megaphone} />
      <Wizard workspaceSlug={workspaceSlug} instances={instances} lists={lists.map((l) => ({ id: l.id, name: l.name, members: l._count.members }))} templates={templates} groups={groups.filter((g) => g._count.members > 0).map((g) => ({ id: g.id, name: g.name, memberCount: g._count.members }))} />
    </div>
  );
}
