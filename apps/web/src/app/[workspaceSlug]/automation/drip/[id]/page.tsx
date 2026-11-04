import { getTranslations } from "next-intl/server";
import { Send } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import EnrolForm from "./enrol-form";

export default async function DripDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const campaign = await db.dripCampaign.findUnique({
    where: { id },
    include: { _count: { select: { enrolments: true } }, instance: { select: { label: true } } },
  });
  if (!campaign) notFound();
  const lists = await db.contactList.findMany({ select: { id: true, name: true, _count: { select: { members: true } } } });
  const steps = campaign.steps as Array<{ templateId: string; delayMs: number }>;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader icon={Send} title={campaign.name} />
      <Card>
        <CardContent className="p-6">
          <dl className="grid grid-cols-2 text-sm gap-y-2">
            <dt className="text-muted-foreground">{t("automation.drip.instance")}</dt><dd>{campaign.instance?.label ?? "?"}</dd>
            <dt className="text-muted-foreground">Steps</dt><dd>{steps.length}</dd>
            <dt className="text-muted-foreground">{t("automation.drip.enrolledCount")}</dt><dd>{campaign._count.enrolments}</dd>
            <dt className="text-muted-foreground">{t("automation.drip.active")}</dt>
            <dd>
              <StatusPill tone={campaign.active ? "success" : "neutral"}>
                {campaign.active ? "Yes" : "No"}
              </StatusPill>
            </dd>
          </dl>
        </CardContent>
      </Card>
      <EnrolForm workspaceSlug={workspaceSlug} campaignId={id} lists={lists.map((l) => ({ id: l.id, name: l.name, members: l._count.members }))} />
    </div>
  );
}
