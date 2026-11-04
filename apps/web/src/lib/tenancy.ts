import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { ForbiddenError } from "@evo/shared";
import type { WorkspaceRole } from "@evo/db";

const RANK: Record<WorkspaceRole, number> = {
  Viewer: 1,
  Agent: 2,
  Admin: 3,
  Owner: 4,
};

export async function requireMember(slug: string, minRole: WorkspaceRole) {
  const session = await auth();
  const userId = session?.user?.id;

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) throw new ForbiddenError("Workspace not found");

  if (!userId) {
    // No session — allow programmatic access via a workspace API key (Admin-level).
    const { verifyApiKey } = await import("@/lib/api-key-auth");
    const keyId = await verifyApiKey(workspace.id).catch(() => null);
    if (keyId) {
      if (RANK.Admin < RANK[minRole]) throw new ForbiddenError("Insufficient role");
      return { workspace, role: "Admin" as WorkspaceRole, userId: `apikey:${keyId}` };
    }
    throw new ForbiddenError("Not signed in");
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
  });
  if (!membership) throw new ForbiddenError("Not a member");

  if (RANK[membership.role] < RANK[minRole]) {
    throw new ForbiddenError("Insufficient role");
  }
  return { workspace, role: membership.role, userId };
}
