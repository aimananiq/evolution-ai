"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export default function AnalyticsTabs({ workspaceSlug }: { workspaceSlug: string }) {
  const pathname = usePathname();
  const t = useTranslations("analytics.tabs");
  const base = `/${workspaceSlug}/analytics`;
  const tabs = [
    { href: `${base}/messages`, label: t("messages") },
    { href: `${base}/broadcasts`, label: t("broadcasts") },
    { href: `${base}/leaderboard`, label: t("leaderboard") },
    { href: `${base}/warmer`, label: t("warmer") },
  ];
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
