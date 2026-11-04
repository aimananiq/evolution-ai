import { Users } from "lucide-react";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import UserActions from "./user-actions";

export default async function AdminUsersPage() {
  const { userId } = await requireSuperAdmin();
  const users = await prisma.user.findMany({
    include: { _count: { select: { memberships: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return (
    <div className="space-y-3 max-w-5xl">
      <PageHeader icon={Users} title="Users" />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Email</th>
              <th className="p-2">Name</th>
              <th className="p-2">Workspaces</th>
              <th className="p-2">Admin</th>
              <th className="p-2">Joined</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-accent/30">
                <td className="p-2">{u.email}{u.id === userId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</td>
                <td className="p-2">{u.name}</td>
                <td className="p-2 text-center">{u._count.memberships}</td>
                <td className="p-2 text-center">{u.isSuperAdmin ? "★" : ""}</td>
                <td className="p-2 text-center text-xs">{u.createdAt.toLocaleDateString("en-GB")}</td>
                <td className="p-2"><UserActions userId={u.id} email={u.email} isSuperAdmin={u.isSuperAdmin} isSelf={u.id === userId} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
