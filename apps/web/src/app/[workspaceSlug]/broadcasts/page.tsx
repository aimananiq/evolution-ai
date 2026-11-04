import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function BroadcastsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const broadcasts = await db.broadcast.findMany({
    include: { list: { select: { name: true } }, _count: { select: { targets: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  function statusLabel(s: string) {
    return t(`broadcasts.status${s[0]!.toUpperCase() + s.slice(1)}` as any);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("broadcasts.title")}
        icon={Megaphone}
        actions={
          <Button asChild>
            <Link href={`/${workspaceSlug}/broadcasts/new`}>{t("broadcasts.new")}</Link>
          </Button>
        }
      />
      {broadcasts.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title={t("broadcasts.title")} />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {broadcasts.map((b) => (
            <div key={b.id} className="p-3 flex justify-between">
              <Link href={`/${workspaceSlug}/broadcasts/${b.id}`} className="block flex-1">
                <strong>{b.name}</strong> <span className="text-sm text-muted-foreground">· {b.list?.name ?? "?"} · {b._count.targets} targets · {statusLabel(b.status)}</span>
              </Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
