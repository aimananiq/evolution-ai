import { redirect } from "next/navigation";

// The integrations hub lives under /settings/integrations; make the bare
// /integrations URL land there instead of 404-ing.
export default async function IntegrationsRedirect({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/settings/integrations`);
}
