import { getTranslations } from "next-intl/server";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import CreateForm from "./create-form";

export default async function NewInstancePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-md space-y-4">
      <PageHeader title={t("instances.new")} icon={Plus} />
      <Card>
        <CardContent className="pt-6">
          <CreateForm workspaceSlug={workspaceSlug} />
        </CardContent>
      </Card>
    </div>
  );
}
