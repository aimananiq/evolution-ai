"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { buildCrumbs } from "@/lib/breadcrumbs";

export function Breadcrumbs({ workspaceName, workspaceSlug }: { workspaceName: string; workspaceSlug: string }) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname ?? "");

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
      <Link href={`/${workspaceSlug}/dashboard`} className="shrink-0 font-medium hover:text-foreground">
        {workspaceName}
      </Link>
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          {c.href ? (
            <Link href={c.href} className="truncate hover:text-foreground">
              {c.label}
            </Link>
          ) : (
            <span className="truncate text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
