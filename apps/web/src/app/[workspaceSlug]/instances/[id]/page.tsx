import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { notFound } from "next/navigation";
import DeleteButton from "./delete-button";
import { revealSecret } from "@evo/crypto";
import { InstanceCredentials } from "./credentials";
import { ConnectPanel } from "./connect-panel";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, QrCode, Send } from "lucide-react";

export default async function InstanceDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  const { workspace, role } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const inst = await db.instance.findUnique({ where: { id } });
  if (!inst) notFound();
  const canSeeKey = role === "Admin" || role === "Owner";
  const keyCount = await db.apiKey.count({ where: { revokedAt: null } });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "your-domain"}`;
  const stateTone =
    inst.connectionState === "open"
      ? "success"
      : inst.connectionState === "connecting"
        ? "warning"
        : inst.connectionState === "close"
          ? "danger"
          : "neutral";

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title={inst.label}
        icon={Smartphone}
        actions={
          <>
            <Button asChild>
              <Link href={`/${workspaceSlug}/instances/${id}/pair`}>
                <QrCode />
                {t("instances.pairTitle")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/${workspaceSlug}/instances/${id}/test-send`}>
                <Send />
                {t("instances.testSend")}
              </Link>
            </Button>
            <DeleteButton workspaceSlug={workspaceSlug} instanceId={id} />
          </>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <dl className="grid grid-cols-2 gap-y-2">
            <dt className="text-sm text-muted-foreground">{t("instances.state")}</dt>
            <dd>
              <StatusPill tone={stateTone}>{inst.connectionState}</StatusPill>
            </dd>
            <dt className="text-sm text-muted-foreground">Phone</dt>
            <dd>{inst.phoneNumber ?? "—"}</dd>
          </dl>
        </CardContent>
      </Card>

      <ConnectPanel
        workspaceSlug={workspaceSlug}
        origin={origin}
        instanceName={inst.evolutionInstanceName}
        keyCount={keyCount}
        canCreateKey={canSeeKey}
      >
        <InstanceCredentials
          instanceName={inst.evolutionInstanceName}
          apiKey={canSeeKey ? await revealSecret(inst.evolutionApiKey) : undefined}
        />
      </ConnectPanel>
    </div>
  );
}
