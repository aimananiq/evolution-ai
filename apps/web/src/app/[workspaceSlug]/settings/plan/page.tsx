import { getTranslations } from "next-intl/server";
import { CreditCard } from "lucide-react";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { requireUnder } from "@evo/limits";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Row({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = cap === Infinity ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{used} / {cap === Infinity ? "∞" : cap}</span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId: workspace.id },
    include: { plan: true },
  });
  const [contact, instance, messageMonthly] = await Promise.all([
    requireUnder(workspace.id, "contact"),
    requireUnder(workspace.id, "instance"),
    requireUnder(workspace.id, "messageMonthly"),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader icon={CreditCard} title={t("plan.title")} />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">{t("plan.currentPlan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {wp?.plan ? (
            <>
              <p className="text-lg font-semibold">{wp.plan.name}</p>
              <p className="text-sm text-muted-foreground">{wp.plan.description}</p>
              <p className="text-xs text-muted-foreground">{t("plan.since")}: {wp.since.toLocaleDateString("en-GB")}</p>
            </>
          ) : (
            <p className="text-muted-foreground">{t("plan.noPlan")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">{t("plan.usage")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label={t("plan.contacts")} used={contact.used} cap={contact.cap} />
          <Row label={t("plan.instances")} used={instance.used} cap={instance.cap} />
          <Row label={t("plan.messagesMonthly")} used={messageMonthly.used} cap={messageMonthly.cap} />
        </CardContent>
      </Card>
    </div>
  );
}
