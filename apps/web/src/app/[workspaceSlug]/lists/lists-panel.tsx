"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ListChecks, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type ContactListItem = {
  id: string;
  name: string;
  _count: { members: number };
};

export default function ListsPanel({
  workspaceSlug,
  initialLists,
}: {
  workspaceSlug: string;
  initialLists: ContactListItem[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/lists`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setCreateError(body.error === "DUPLICATE_NAME" ? "A list with that name already exists." : "Could not create list.");
      return;
    }
    setNewName("");
    router.refresh();
  }

  async function deleteList(id: string, name: string) {
    if (!confirm(`Delete list "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/workspaces/${workspaceSlug}/lists/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={createList} className="flex items-center gap-2">
        <input
          className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="New list name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={120}
        />
        <Button type="submit" disabled={creating || !newName.trim()}>
          {creating ? "Creating…" : "Create"}
        </Button>
      </form>
      {createError && <p className="text-sm text-destructive">{createError}</p>}

      {initialLists.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="No lists yet"
            description="Create a list above, or import contacts and assign them to a list during import."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {initialLists.map((list) => (
            <Card key={list.id} className="transition-colors hover:border-primary/50">
              <CardContent className="flex items-center justify-between p-0">
                <Link
                  href={`/${workspaceSlug}/lists/${list.id}`}
                  className="flex flex-1 items-center gap-2 p-4"
                >
                  <div className="flex-1">
                    <p className="font-medium">{list.name}</p>
                    <p className="text-xs text-muted-foreground">{list._count.members} contacts · click to manage</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => deleteList(list.id, list.name)}
                  title="Delete list"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
