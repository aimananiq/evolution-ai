"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { signOutAction } from "@/components/shell/sign-out-action";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavList } from "./nav-config";
import { BrandMark } from "./brand-mark";

/** Hamburger + slide-in drawer for small screens. Desktop uses <Sidebar>. */
export function MobileNav({ workspaceSlug, labels }: { workspaceSlug: string; labels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
              <div className="flex items-center gap-2">
                <BrandMark />
                <span className="font-semibold tracking-tight">Wasap-IUC</span>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavList base={base} pathname={pathname} labels={labels} onNavigate={() => setOpen(false)} />
            </div>
            <div className="flex shrink-0 items-center justify-between border-t px-3 py-2">
              <form action={signOutAction}>
                <button type="submit" className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </form>
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
