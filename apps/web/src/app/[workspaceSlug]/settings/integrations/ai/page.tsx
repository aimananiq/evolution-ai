import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import AiScopes from "./ai-scopes";

export default async function AiKeysPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const rows = await prisma.workspaceAiKey.findMany({ where: { workspaceId: workspace.id } });
  const initials: Record<string, { provider: string; defaultModel: string; endpoint?: string | null } | null> = {};
  for (const s of ["default", "warmer", "chatbot"]) {
    const row = rows.find((r) => r.scope === s);
    initials[s] = row ? { provider: row.provider, defaultModel: row.defaultModel ?? "", endpoint: row.endpoint ?? "" } : null;
  }
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={Sparkles} title={t("aiKeys.title")} description="Set one AI provider per feature — e.g. a cheap model for the warmer and a better one for the chatbot." />
      <AiScopes workspaceSlug={workspaceSlug} initials={initials} />
    </div>
  );
}
