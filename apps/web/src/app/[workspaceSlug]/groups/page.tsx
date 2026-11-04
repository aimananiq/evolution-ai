import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { getTranslations } from "next-intl/server";
import GroupsBrowser from "./groups-browser";

export default async function GroupsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({ select: { id: true, label: true } });
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">{t("groups.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("groups.help")}</p>
      <GroupsBrowser workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
