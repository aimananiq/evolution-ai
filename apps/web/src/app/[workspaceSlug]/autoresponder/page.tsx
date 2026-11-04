import { getTranslations } from "next-intl/server";
import { Bot } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import AutoresponderEditor from "./autoresponder-editor";

export default async function AutoresponderPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);

  const [instances, lists] = await Promise.all([
    db.instance.findMany({ select: { id: true, label: true }, orderBy: { label: "asc" } }),
    db.contactList.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Load the autoresponder config for the first instance (if any).
  const defaultInstance = instances[0];
  const initial = defaultInstance
    ? await db.autoresponder.findUnique({ where: { instanceId: defaultInstance.id } })
    : null;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t("autoresponder.title")} icon={Bot} />
      <AutoresponderEditor
        workspaceSlug={workspaceSlug}
        instances={instances}
        lists={lists}
        initial={initial ? {
          instanceId: initial.instanceId,
          enabled: initial.enabled,
          sendTo: initial.sendTo as "all" | "individual" | "group",
          text: initial.text,
          caption: initial.caption,
          mediaAssetId: initial.mediaAssetId,
          rejectCall: initial.rejectCall,
          msgCall: initial.msgCall,
          pausePerCustomerSec: initial.pausePerCustomerSec,
          scheduleJson: initial.scheduleJson as {
            parts: ("daytime" | "nighttime" | "odd" | "even")[];
            startHour?: number;
            endHour?: number;
          } | null,
          excludeContactListIds: initial.excludeContactListIds,
        } : null}
      />
    </div>
  );
}
