"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { EmptyState } from "@/components/ui/empty-state";

type Conv = { id: string; contactPhone: string; contactName: string | null; lastMessageAt: string; unreadCount: number; status: string; assignedToUserId: string | null };

export default function ConversationList({ workspaceSlug, currentUserId, initial }: { workspaceSlug: string; currentUserId: string; initial: Conv[] }) {
  const t = useTranslations();
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"all" | "mine" | "unassigned" | "open">("all");

  useEffect(() => {
    const s = getSocket();
    function onEvent(payload: any) {
      if (payload?.event?.kind === "message" && payload?.event?.conversationId) {
        setItems((curr) => {
          const idx = curr.findIndex((c) => c.id === payload.event.conversationId);
          if (idx === -1) return curr;
          const next = [...curr];
          const updated = { ...next[idx]!, lastMessageAt: payload.event.sentAt, unreadCount: next[idx]!.unreadCount + (payload.event.direction === "inbound" ? 1 : 0) };
          next.splice(idx, 1);
          return [updated, ...next];
        });
      }
    }
    s.on("event", onEvent);
    return () => { s.off("event", onEvent); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "open") return items.filter((i) => i.status === "open");
    if (filter === "mine") return items.filter((i) => i.assignedToUserId === currentUserId);
    if (filter === "unassigned") return items.filter((i) => i.assignedToUserId === null);
    return items;
  }, [items, filter, currentUserId]);

  return (
    <aside className="w-80 border-r overflow-y-auto">
      <div className="p-3 border-b">
        <h1 className="text-lg font-semibold mb-2">{t("inbox.title")}</h1>
        <div className="flex gap-1 text-xs">
          {(["all", "mine", "unassigned", "open"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2 py-1 rounded ${filter === f ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {t(`inbox.filter${f[0]!.toUpperCase() + f.slice(1)}` as any)}
            </button>
          ))}
        </div>
      </div>
      <ul>
        {filtered.map((c) => (
          <li key={c.id} className="border-b">
            <Link href={`/${workspaceSlug}/inbox/${c.id}`} className="block p-3 hover:bg-accent">
              <div className="flex justify-between">
                <strong>{c.contactName ?? c.contactPhone}</strong>
                {c.unreadCount > 0 && <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">{c.unreadCount}</span>}
              </div>
              <div className="text-xs text-muted-foreground">{new Date(c.lastMessageAt).toLocaleString("en-GB")}</div>
            </Link>
          </li>
        ))}
        {filtered.length === 0 && (
          <li>
            <EmptyState icon={Inbox} title={t("inbox.emptyList")} />
          </li>
        )}
      </ul>
    </aside>
  );
}
