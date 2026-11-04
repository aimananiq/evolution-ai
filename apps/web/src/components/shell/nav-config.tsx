"use client";
import Link from "next/link";
import {
  LayoutDashboard, MessageSquare, Users, FileText, Megaphone,
  Workflow, Flame, BarChart3, Smartphone, Settings, FolderOpen, Webhook, Reply, QrCode,
  IdCard, Download, UsersRound, HeartPulse, Tag, MessageSquareText, BookOpen, Bot, ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Key = string;
type Item = { key: Key; path: string; icon: React.ComponentType<{ className?: string }> };
type Group = { title?: string; items: Item[] };

// Grouped navigation. `key` maps to a label in the `labels` map; `path` is the
// suffix appended to `/{workspaceSlug}`. Shared by the desktop sidebar + mobile drawer.
export const NAV_GROUPS: Group[] = [
  { items: [{ key: "dashboard", path: "/dashboard", icon: LayoutDashboard }] },
  {
    title: "Messaging",
    items: [
      { key: "inbox", path: "/inbox", icon: MessageSquare },
      { key: "broadcasts", path: "/broadcasts", icon: Megaphone },
      { key: "templates", path: "/templates", icon: FileText },
      { key: "autoresponder", path: "/autoresponder", icon: Reply },
    ],
  },
  {
    title: "Audience",
    items: [
      { key: "contacts", path: "/contacts", icon: Users },
      { key: "lists", path: "/lists", icon: ListChecks },
      { key: "labels", path: "/labels", icon: Tag },
      { key: "leads", path: "/leads", icon: UsersRound },
      { key: "exportParticipants", path: "/export-participants", icon: Download },
    ],
  },
  {
    title: "Automation",
    items: [
      { key: "automation", path: "/automation", icon: Workflow },
      { key: "warmer", path: "/warmer", icon: Flame },
      { key: "assistants", path: "/assistants", icon: Bot },
      { key: "health", path: "/health", icon: HeartPulse },
    ],
  },
  { title: "Insights", items: [{ key: "analytics", path: "/analytics", icon: BarChart3 }] },
  {
    title: "Tools",
    items: [
      { key: "instances", path: "/instances", icon: Smartphone },
      { key: "files", path: "/files", icon: FolderOpen },
      { key: "captions", path: "/captions", icon: MessageSquareText },
      { key: "linkGenerator", path: "/link-generator", icon: QrCode },
    ],
  },
  {
    title: "Account",
    items: [
      { key: "integrations", path: "/settings/integrations", icon: Webhook },
      { key: "documentation", path: "/docs", icon: BookOpen },
      { key: "profile", path: "/profile", icon: IdCard },
      { key: "settings", path: "/settings/members", icon: Settings },
    ],
  },
];

export function NavList({
  base, pathname, labels, onNavigate,
}: {
  base: string;
  pathname: string;
  labels: Record<string, string>;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-4 px-3 py-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="space-y-1">
          {group.title && (
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </div>
          )}
          {group.items.map(({ key, path, icon: Icon }) => {
            const href = `${base}${path}`;
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={key}
                href={href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {labels[key]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
