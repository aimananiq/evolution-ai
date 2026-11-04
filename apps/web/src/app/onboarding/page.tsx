import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import OnboardingForm from "./onboarding-form";

/**
 * Server guard: an already-onboarded user (has any workspace membership) is sent
 * straight to their workspace. Only users with NO workspace see the create form,
 * so signing in repeatedly never spawns duplicate workspaces.
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const member = await prisma.workspaceMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    include: { workspace: { select: { slug: true } } },
  });
  if (member) redirect(`/${member.workspace.slug}/dashboard`);

  return <OnboardingForm />;
}
