import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import TemplatesForm from "./templates-form";

export default async function TemplatesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const templates = await db.messageTemplate.findMany({ orderBy: { name: "asc" } });
  // Available merge tags: sample recent contacts and collect their custom-field keys.
  const contacts = await db.contact.findMany({ select: { customFields: true }, take: 500 });
  const keys = [...new Set(contacts.flatMap((c) => Object.keys((c.customFields ?? {}) as object)))];
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t("templates.title")} icon={FileText} />
      <TemplatesForm workspaceSlug={workspaceSlug} initial={templates.map((tpl) => ({ id: tpl.id, name: tpl.name, body: tpl.body }))} customFieldKeys={keys} />
    </div>
  );
}
