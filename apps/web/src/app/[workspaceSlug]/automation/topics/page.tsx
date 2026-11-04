import { redirect } from "next/navigation";

export default async function TopicsRedirect({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/assistants`);
}
