import { Building2 } from "lucide-react";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import CreateTenant from "./create-tenant";
import WorkspaceActions from "./workspace-actions";

export default async function AdminWorkspacesPage() {
  await requireSuperAdmin();
  const [workspaces, plans] = await Promise.all([
    prisma.workspace.findMany({
      include: {
        _count: { select: { members: true, instances: true, contacts: true } },
        plan: { include: { plan: { select: { name: true, kind: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.plan.findMany({ select: { kind: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader icon={Building2} title="Workspaces" />
      <CreateTenant />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Name</th>
              <th className="p-2">Members</th>
              <th className="p-2">Numbers</th>
              <th className="p-2">Contacts</th>
              <th className="p-2">Created</th>
              <th className="p-2 text-right">Plan / actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {workspaces.map((w) => (
              <tr key={w.id} className="hover:bg-accent/30">
                <td className="p-2">
                  <div className="font-medium">{w.name}</div>
                  <div className="text-xs text-muted-foreground">{w.slug}</div>
                </td>
                <td className="p-2 text-center">{w._count.members}</td>
                <td className="p-2 text-center">{w._count.instances}</td>
                <td className="p-2 text-center">{w._count.contacts}</td>
                <td className="p-2 text-center text-xs">{w.createdAt.toLocaleDateString("en-GB")}</td>
                <td className="p-2">
                  <WorkspaceActions workspaceId={w.id} name={w.name} currentPlanKind={w.plan?.plan?.kind ?? null} plans={plans} />
                </td>
              </tr>
            ))}
            {workspaces.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No workspaces yet — create one above.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
