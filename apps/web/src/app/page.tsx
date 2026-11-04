import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";

/** Landing resolver: signed-out -> sign-in; signed-in -> their workspace (or onboarding if none). */
export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    include: { workspace: { select: { slug: true } } },
  });
  redirect(member ? `/${member.workspace.slug}/dashboard` : "/onboarding");
}
