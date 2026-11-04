import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./mobile-nav";

export function Topbar({
  workspaceName, workspaceSlug, labels,
}: {
  workspaceName: string;
  workspaceSlug?: string;
  labels?: Record<string, string>;
}) {
  const initials = workspaceName.slice(0, 2).toUpperCase();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {workspaceSlug && labels && <MobileNav workspaceSlug={workspaceSlug} labels={labels} />}
        {workspaceSlug ? (
          <Breadcrumbs workspaceName={workspaceName} workspaceSlug={workspaceSlug} />
        ) : (
          <span className="text-sm font-medium text-muted-foreground">{workspaceName}</span>
        )}
      </div>
      <Avatar className="h-8 w-8">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
    </header>
  );
}
