import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ForbiddenError } from "@evo/shared";
import { requireMember } from "@/lib/tenancy";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let workspace;
  try {
    ({ workspace } = await requireMember(workspaceSlug, "Viewer"));
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/sign-in");
    throw e;
  }
  const t = await getTranslations();
  const labels = {
    dashboard: t("nav.dashboard"), inbox: t("nav.inbox"), contacts: t("nav.contacts"),
    templates: t("nav.templates"), broadcasts: t("nav.broadcasts"), automation: t("nav.automation"),
    autoresponder: t("nav.autoresponder"),
    warmer: t("nav.warmer"), topics: t("nav.topics"), assistants: t("nav.assistants"), health: t("nav.health"), files: t("nav.files"), analytics: t("nav.analytics"),
    instances: t("nav.instances"), settings: t("nav.settings"), integrations: t("nav.integrations"),
    linkGenerator: t("nav.linkGenerator"),
    profile: t("nav.profile"),
    exportParticipants: t("nav.exportParticipants"),
    labels: t("nav.labels"),
    lists: t("nav.lists"),
    captions: t("nav.captions"),
    leads: t("nav.leads"),
    documentation: t("nav.documentation"),
  };
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar workspaceSlug={workspaceSlug} labels={labels} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar workspaceName={workspace.name} workspaceSlug={workspaceSlug} labels={labels} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
