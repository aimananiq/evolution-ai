import { getTranslations } from "next-intl/server";
import { UserCircle } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import ProfilePanel from "./profile-panel";

export default async function ProfilePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("profile");
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({
    select: { id: true, label: true, phoneNumber: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={UserCircle} title={t("title")} />
      <ProfilePanel workspaceSlug={workspaceSlug} instances={instances} />
    </div>
  );
}
