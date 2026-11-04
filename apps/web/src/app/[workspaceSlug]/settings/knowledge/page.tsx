import { getTranslations } from "next-intl/server";
import { BookOpen } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import KnowledgeForm from "./knowledge-form";

export default async function KnowledgePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const items = await db.knowledgeSnippet.findMany({ orderBy: { updatedAt: "desc" } });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={BookOpen} title={t("knowledge.title")} description={t("knowledge.subtitle")} />
      <KnowledgeForm
        workspaceSlug={workspaceSlug}
        initialItems={items.map((i) => ({ id: i.id, title: i.title, content: i.content, enabled: i.enabled }))}
      />
    </div>
  );
}
