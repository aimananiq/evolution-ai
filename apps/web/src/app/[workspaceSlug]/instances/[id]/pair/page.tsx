import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { QrCode } from "lucide-react";
import PairView from "./pair-view";

export default async function PairPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="space-y-4 max-w-lg">
      <PageHeader
        title={t("instances.pairTitle")}
        description={t("instances.pairHint")}
        icon={QrCode}
      />
      <Card>
        <CardContent className="pt-6">
          <PairView workspaceSlug={workspaceSlug} instanceId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
