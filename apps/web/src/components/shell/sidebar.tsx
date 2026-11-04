"use client";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutAction } from "@/components/shell/sign-out-action";
import { NavList } from "./nav-config";
import { BrandMark } from "./brand-mark";

export function Sidebar({ workspaceSlug, labels }: { workspaceSlug: string; labels: Record<string, string> }) {
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  return (
    <aside className="hidden md:flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 px-5">
        <BrandMark />
        <span className="font-semibold tracking-tight">Wasap-IUC</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NavList base={base} pathname={pathname} labels={labels} />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t px-3 py-2">
        <form action={signOutAction}>
          <button
            type="submit"
            title="Sign out"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
        <ThemeToggle />
      </div>
    </aside>
  );
}
