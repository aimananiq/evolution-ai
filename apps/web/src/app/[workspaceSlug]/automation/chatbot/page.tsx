import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bot } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export default async function ChatbotsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const instances = await db.instance.findMany({
    include: { chatbot: { include: { _count: { select: { triggers: true } } } } },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader icon={Bot} title={t("automation.chatbots")} />
      <Card>
        <CardContent className="p-0 divide-y">
          {instances.length === 0 && (
            <EmptyState icon={Bot} title="—" />
          )}
          {instances.map((inst) => (
            <div key={inst.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <strong className="truncate">{inst.label}</strong>
                {inst.chatbot ? (
                  <>
                    <StatusPill tone={inst.chatbot.enabled ? "success" : "neutral"}>
                      {inst.chatbot.enabled ? "enabled" : "disabled"}
                    </StatusPill>
                    <span className="text-sm text-muted-foreground">{inst.chatbot._count.triggers} triggers</span>
                  </>
                ) : (
                  <StatusPill tone="neutral">not configured</StatusPill>
                )}
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${workspaceSlug}/automation/chatbot/${inst.id}`}>{t("instances.openDetail")}</Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
