import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { ForbiddenError } from "@evo/shared";

export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new ForbiddenError("Not signed in");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, isSuperAdmin: true } });
  if (!user || !user.isSuperAdmin) throw new ForbiddenError("Not a super-admin");
  return { userId: user.id };
}
