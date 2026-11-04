"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

type Topic = { id: string; name: string; snippetCount: number; chatbotCount: number };

export default function TopicsList({
  workspaceSlug,
  initial,
}: {
  workspaceSlug: string;
  initial: Topic[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createTopic() {
    const name = prompt("Topic name")?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) {
        alert("A topic with that name already exists.");
        return;
      }
      if (!res.ok) return;
      const { topic } = await res.json();
      router.push(`/${workspaceSlug}/automation/topics/${topic.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex justify-end">
        <Button onClick={createTopic} disabled={busy}>
          <Plus />
          New topic
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {initial.length === 0 && (
            <EmptyState
              icon={Bot}
              title="No topics yet"
              description="Create your first assistant topic."
            />
          )}
          {initial.map((t) => (
            <Link
              key={t.id}
              href={`/${workspaceSlug}/automation/topics/${t.id}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-secondary/40 transition-colors"
            >
              <strong className="truncate">{t.name}</strong>
              <span className="shrink-0 text-sm text-muted-foreground">
                {t.snippetCount} knowledge · used by {t.chatbotCount} number(s)
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
