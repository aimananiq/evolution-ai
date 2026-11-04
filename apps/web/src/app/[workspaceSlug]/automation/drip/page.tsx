import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Send, Plus } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default async function DripListPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const campaigns = await db.dripCampaign.findMany({
    include: { _count: { select: { enrolments: true } }, instance: { select: { label: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        icon={Send}
        title={t("automation.drip")}
        actions={
          <Button asChild>
            <Link href={`/${workspaceSlug}/automation/drip/new`}>
              <Plus />
              {t("automation.drip.newCampaign")}
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-0 divide-y">
          {campaigns.length === 0 && (
            <EmptyState icon={Send} title="—" />
          )}
          {campaigns.map((c) => (
            <Link key={c.id} href={`/${workspaceSlug}/automation/drip/${c.id}`} className="block p-4 transition-colors hover:bg-accent">
              <strong>{c.name}</strong>{" "}
              <span className="text-sm text-muted-foreground">· {c.instance?.label} · {c._count.enrolments} {t("automation.drip.enrolledCount")}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
