import { CreditCard } from "lucide-react";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { PageHeader } from "@/components/ui/page-header";
import PlansEditor from "./plans-editor";

export default async function AdminPlansPage() {
  await requireSuperAdmin();
  const plans = await prisma.plan.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader icon={CreditCard} title="Plans" />
      <PlansEditor
        initial={plans.map((p) => ({
          id: p.id, kind: p.kind, name: p.name, description: p.description,
          contactCap: p.contactCap, instanceCap: p.instanceCap, monthlyMessageCap: p.monthlyMessageCap,
          featureFlags: p.featureFlags,
        }))}
      />
    </div>
  );
}
