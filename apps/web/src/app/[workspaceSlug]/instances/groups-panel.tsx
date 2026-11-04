"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Trash2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type InstanceRow = { id: string; label: string; connectionState: string };
type GroupRow = { id: string; name: string; memberIds: string[] };

export default function GroupsPanel({
  workspaceSlug,
  instances,
  initialGroups,
}: {
  workspaceSlug: string;
  instances: InstanceRow[];
  initialGroups: GroupRow[];
}) {
  const router = useRouter();
  const base = `/api/workspaces/${workspaceSlug}/instance-groups`;
  const [groups, setGroups] = useState<GroupRow[]>(initialGroups);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError(null);
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error === "DUPLICATE_NAME" ? "A group with that name already exists." : "Could not create group.");
      return;
    }
    const { group } = await res.json();
    setGroups((g) => [...g, { id: group.id, name: group.name, memberIds: [] }]);
    setNewName("");
    router.refresh();
  }

  async function toggleMember(group: GroupRow, instanceId: string) {
    const has = group.memberIds.includes(instanceId);
    setGroups((gs) => gs.map((g) => g.id === group.id
      ? { ...g, memberIds: has ? g.memberIds.filter((x) => x !== instanceId) : [...g.memberIds, instanceId] }
      : g));
    await fetch(`${base}/${group.id}/members`, {
      method: has ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceIds: [instanceId] }),
    }).catch(() => {});
  }

  async function deleteGroup(group: GroupRow) {
    if (!confirm(`Delete group "${group.name}"? Numbers are not deleted.`)) return;
    setGroups((gs) => gs.filter((g) => g.id !== group.id));
    await fetch(`${base}/${group.id}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Number groups</h2>
        </div>
        <p className="text-sm text-muted-foreground">Group numbers so a broadcast can blast across the whole group (in parallel or rotating one at a time).</p>

        <form onSubmit={createGroup} className="flex items-center gap-2">
          <input className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="New group name (e.g. Blast Collection)…" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} />
          <Button type="submit" disabled={busy || !newName.trim()}><Plus className="h-4 w-4 mr-1" /> Create</Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{g.name} <span className="text-xs text-muted-foreground">· {g.memberIds.length} number{g.memberIds.length === 1 ? "" : "s"}</span></p>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => deleteGroup(g)} title="Delete group">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {instances.map((inst) => (
                    <label key={inst.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={g.memberIds.includes(inst.id)} onChange={() => toggleMember(g, inst.id)} />
                      <span>{inst.label}</span>
                      <span className={`ml-auto text-xs ${inst.connectionState === "open" ? "text-success" : "text-muted-foreground"}`}>{inst.connectionState}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
