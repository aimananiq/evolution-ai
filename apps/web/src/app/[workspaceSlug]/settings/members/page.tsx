import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import InviteForm from "./invite-form";
import RemoveButton from "./remove-button";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace, userId } = await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const members = await db.workspaceMember.findMany({
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invitations = await db.invitation.findMany({
    where: { acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader icon={Users} title={t("members.title")} />

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.id} className="p-3 flex justify-between items-center">
                <span>
                  {m.user.name} ({m.user.email}){" "}
                  <StatusPill tone="neutral" dot={false}>{m.role}</StatusPill>
                  {m.userId === userId && ` ${t("members.you")}`}
                </span>
                {m.role !== "Owner" && m.userId !== userId && (
                  <RemoveButton workspaceSlug={workspaceSlug} memberId={m.id} />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("members.inviteHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm workspaceSlug={workspaceSlug} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("members.pendingInvitations")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y border-t">
            {invitations.map((inv) => (
              <li key={inv.id} className="p-3">
                {inv.email} — {inv.role} — <code className="text-xs">{inv.token}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
