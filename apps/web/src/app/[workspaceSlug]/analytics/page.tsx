import { redirect } from "next/navigation";

export default async function AnalyticsRoot({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/analytics/messages`);
}
