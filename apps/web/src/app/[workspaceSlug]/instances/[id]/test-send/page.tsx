import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Send } from "lucide-react";
import SendForm from "./send-form";

export default async function TestSendPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { workspaceSlug, id } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-lg space-y-4">
      <PageHeader title={t("instances.testSend")} icon={Send} />
      <Card>
        <CardContent className="pt-6">
          <SendForm workspaceSlug={workspaceSlug} instanceId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
