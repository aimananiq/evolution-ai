import AnalyticsTabs from "./analytics-tabs";

export default async function AnalyticsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <div className="space-y-6">
      <AnalyticsTabs workspaceSlug={workspaceSlug} />
      {children}
    </div>
  );
}
