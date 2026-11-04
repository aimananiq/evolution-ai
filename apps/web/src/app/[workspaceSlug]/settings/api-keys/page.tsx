import { getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import KeysForm from "./keys-form";

export default async function ApiKeysPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const keys = await db.apiKey.findMany({
    where: { revokedAt: null },
    select: { id: true, name: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={KeyRound} title={t("apiKeys.title")} />
      <KeysForm workspaceSlug={workspaceSlug} initial={keys.map((k) => ({ id: k.id, name: k.name, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))} />
    </div>
  );
}
