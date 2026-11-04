import { getTranslations } from "next-intl/server";
import { ScrollText } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";

export default async function AuditPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const events = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader icon={ScrollText} title={t("audit.title")} />
      {events.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={ScrollText} title={t("audit.noEvents")} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr><th className="p-2 text-left">{t("audit.when")}</th><th className="p-2 text-left">{t("audit.action")}</th><th className="p-2 text-left">{t("audit.target")}</th><th className="p-2 text-left">{t("audit.user")}</th></tr>
              </thead>
              <tbody className="divide-y">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="p-2 text-xs">{e.createdAt.toLocaleString("en-GB")}</td>
                    <td className="p-2 font-mono text-xs">{e.action}</td>
                    <td className="p-2 font-mono text-xs">{e.target}</td>
                    <td className="p-2 text-xs">{e.userId ?? "system"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
