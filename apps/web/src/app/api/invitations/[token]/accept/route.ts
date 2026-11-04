import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { auth } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const userId = session.user.id;

  const result = await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({ where: { token } });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
      return { ok: false as const };
    }
    // Bind acceptance to the invited email: a leaked/forwarded token must not let a
    // different signed-in account join the workspace. Checked before the invite is
    // consumed so the real invitee can still accept.
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return { ok: false as const, reason: "email" as const };
    }
    const stamped = await tx.invitation.updateMany({
      where: { token, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (stamped.count === 0) {
      return { ok: false as const };
    }
    const member = await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      update: {},
    });
    const workspace = await tx.workspace.findUnique({ where: { id: invitation.workspaceId } });
    return { ok: true as const, member, workspace };
  });

  if (!result.ok) {
    if ("reason" in result && result.reason === "email") {
      return NextResponse.json({ error: "EMAIL_MISMATCH" }, { status: 403 });
    }
    return NextResponse.json({ error: "INVALID_OR_EXPIRED" }, { status: 410 });
  }
  if (!result.workspace) {
    return NextResponse.json({ error: "WORKSPACE_GONE" }, { status: 410 });
  }
  return NextResponse.json({ workspaceSlug: result.workspace.slug, role: result.member.role });
}
