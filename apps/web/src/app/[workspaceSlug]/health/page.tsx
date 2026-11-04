import { getTranslations } from "next-intl/server";
import { HeartPulse } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { remainingBulkToday } from "@evo/send";
import { computeHealthScore, type HealthMetrics, type Factor } from "@evo/health";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { PolicyEditor, AckButton } from "./health-client";
import { TestDeliveryButton } from "./test-delivery-button";

const DEFAULT_POLICY = { rampEnabled: false, rampBaseDaily: 20, rampGrowthPct: 15, rampMaxDaily: 500, autoProtect: false };

function deliveryBadge(status: string, checkedAt: Date | null): { icon: string; label: string } {
  const suffix = checkedAt
    ? ` · checked ${formatRelative(checkedAt)}`
    : "";
  switch (status) {
    case "ok":
      return { icon: "🟢", label: `Delivering${suffix}` };
    case "delivery_failing":
      return { icon: "🔴", label: `Slow-ban suspected${suffix}` };
    case "send_failing":
      return { icon: "🔴", label: `Not sending (dead session)${suffix}` };
    default:
      return { icon: "⚪", label: "Delivery unchecked" };
  }
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 2) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function riskLabel(t: (k: string) => string, risk: string): string {
  return risk === "healthy" ? t("healthy") : risk === "caution" ? t("caution") : t("atRisk");
}

function riskTone(risk: string): "success" | "warning" | "danger" {
  return risk === "healthy" ? "success" : risk === "caution" ? "warning" : "danger";
}

export default async function HealthPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("health");
  const db = tenantClient(workspace.id);
  const canEdit = role === "Admin" || role === "Owner";

  const instances = await db.instance.findMany({ orderBy: { label: "asc" } });

  const cards = await Promise.all(instances.map(async (inst) => {
    const snapshot = await db.instanceHealthSnapshot.findFirst({
      where: { instanceId: inst.id }, orderBy: { date: "desc" },
    });
    const policy = await db.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
    const remaining = await remainingBulkToday(inst.id, new Date());
    const alerts = await db.healthAlert.findMany({
      where: { instanceId: inst.id, acknowledgedAt: null }, orderBy: { createdAt: "desc" }, take: 10,
    });
    const metrics = (snapshot?.metrics as unknown as HealthMetrics | undefined) ?? null;
    const factors: Factor[] = metrics ? computeHealthScore(metrics).factors : [];
    return { inst, snapshot, policy, remaining, alerts, factors, metrics };
  }));

  return (
    <div className="space-y-6">
      <PageHeader icon={HeartPulse} title={t("title")} description={t("subtitle")} />
      {cards.length === 0 && <EmptyState icon={HeartPulse} title={t("empty")} />}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ inst, snapshot, policy, remaining, alerts, factors, metrics }) => {
          const badge = deliveryBadge(inst.deliveryStatus, inst.deliveryCheckedAt);
          return (
          <Card key={inst.id} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <strong>{inst.label}</strong>
                <div className="text-xs text-muted-foreground">{inst.phoneNumber ?? "—"}</div>
              </div>
              <div className="text-right">
                {snapshot ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-2xl font-semibold">{snapshot.score}</div>
                    <StatusPill tone={riskTone(snapshot.risk)}>{riskLabel(t, snapshot.risk)}</StatusPill>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">{t("gatheringData")}</div>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {t("todayUsage")}:{" "}
              {policy?.rampEnabled && remaining !== null
                ? `${remaining} ${t("remaining")}`
                : t("unlimited")}
            </div>

            {factors.length > 0 && (
              <ul className="text-xs space-y-1">
                {factors.map((f) => (
                  <li key={f.key} className="flex justify-between">
                    <span>{t(f.key)}</span>
                    <span className="text-muted-foreground">
                      {f.insufficientData ? t("gatheringData") : `${Math.round(f.goodness * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {metrics && metrics.businessInitiatedConversations >= 10 && metrics.replyRatio < 0.1 && (
              <p className="text-xs text-amber-600">{t("improveHint")}</p>
            )}

            {alerts.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium">{t("alerts")}</div>
                {alerts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span>{t(a.kind)}</span>
                    <AckButton workspaceSlug={workspaceSlug} alertId={a.id} />
                  </div>
                ))}
              </div>
            )}

            {/* Delivery health badge */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {badge.icon} {badge.label}
              </div>
              <TestDeliveryButton workspaceSlug={workspaceSlug} instanceId={inst.id} />
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer">{t("policy")}</summary>
              <div className="pt-2">
                <PolicyEditor
                  workspaceSlug={workspaceSlug}
                  instanceId={inst.id}
                  canEdit={canEdit}
                  initial={{
                    rampEnabled: policy?.rampEnabled ?? DEFAULT_POLICY.rampEnabled,
                    rampBaseDaily: policy?.rampBaseDaily ?? DEFAULT_POLICY.rampBaseDaily,
                    rampGrowthPct: policy?.rampGrowthPct ?? DEFAULT_POLICY.rampGrowthPct,
                    rampMaxDaily: policy?.rampMaxDaily ?? DEFAULT_POLICY.rampMaxDaily,
                    autoProtect: policy?.autoProtect ?? DEFAULT_POLICY.autoProtect,
                  }}
                />
              </div>
            </details>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
