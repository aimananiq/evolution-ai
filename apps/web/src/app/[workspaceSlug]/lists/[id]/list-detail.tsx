"use client";
import { useEffect, useRef, useState } from "react";
import { ListChecks, Trash2, Plus, Search, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type Member = { id: string; name: string | null; phoneE164: string };

export default function ListDetail({
  workspaceSlug,
  listId,
  initialName,
  initialMembers,
  totalCount,
  capped,
}: {
  workspaceSlug: string;
  listId: string;
  initialName: string;
  initialMembers: Member[];
  totalCount: number;
  capped: boolean;
}) {
  const base = `/api/workspaces/${workspaceSlug}`;

  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [renaming, setRenaming] = useState(false);

  const [members, setMembers] = useState<Member[]>(initialMembers);
  const memberIds = new Set(members.map((m) => m.id));

  // Add-contacts picker
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Record<string, Member>>({});
  const [busy, setBusy] = useState(false);
  const searchSeq = useRef(0);

  async function rename() {
    const next = name.trim();
    if (!next || next === savedName) { setRenaming(false); return; }
    const res = await fetch(`${base}/lists/${listId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (res.ok) { setSavedName(next); setRenaming(false); }
    else {
      const b = await res.json().catch(() => ({}));
      alert(b.error === "DUPLICATE_NAME" ? "A list with that name already exists." : "Could not rename list.");
      setName(savedName);
    }
  }

  async function removeMember(m: Member) {
    setMembers((prev) => prev.filter((x) => x.id !== m.id));
    await fetch(`${base}/lists/${listId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: [m.id] }),
    }).catch(() => {});
  }

  // Debounced contact search when the picker is open.
  useEffect(() => {
    if (!adding) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const url = `${base}/contacts${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`;
      const res = await fetch(url).catch(() => null);
      if (seq !== searchSeq.current) return; // a newer search superseded this one
      const body = res && res.ok ? await res.json().catch(() => ({ contacts: [] })) : { contacts: [] };
      setResults((body.contacts ?? []).map((c: any) => ({ id: c.id, name: c.name, phoneE164: c.phoneE164 })));
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, adding, base]);

  function toggleSelect(m: Member) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[m.id]) delete next[m.id];
      else next[m.id] = m;
      return next;
    });
  }

  async function addSelected() {
    const picks = Object.values(selected);
    if (!picks.length) return;
    setBusy(true);
    const res = await fetch(`${base}/lists/${listId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: picks.map((p) => p.id) }),
    });
    setBusy(false);
    if (!res.ok) { alert("Could not add contacts."); return; }
    // Merge into the member list (dedupe), then reset the picker.
    setMembers((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const p of picks) byId.set(p.id, p);
      return [...byId.values()].sort((a, b) => (a.name ?? a.phoneE164).localeCompare(b.name ?? b.phoneE164));
    });
    setSelected({});
    setQuery("");
    setAdding(false);
  }

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="space-y-4">
      {/* Header: list name (rename) + count */}
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-primary/10 p-2 text-primary"><ListChecks className="h-5 w-5" /></span>
        {renaming ? (
          <input
            autoFocus
            className="flex-1 border border-border rounded-md px-3 py-1.5 text-lg font-semibold bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") { setName(savedName); setRenaming(false); } }}
            maxLength={120}
          />
        ) : (
          <button className="flex items-center gap-2 text-left" onClick={() => setRenaming(true)} title="Rename list">
            <span className="text-xl font-semibold">{savedName}</span>
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {members.length}{capped ? `+` : ""} contact{members.length === 1 ? "" : "s"} in this list
        {capped && <span> (showing the first {members.length} of {totalCount})</span>}
      </p>

      {/* Add contacts */}
      {!adding ? (
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" /> Add contacts</Button>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  autoFocus
                  className="w-full border border-border rounded-md pl-8 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Search contacts by name or number…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button onClick={addSelected} disabled={busy || selectedCount === 0}>
                {busy ? "Adding…" : `Add${selectedCount ? ` ${selectedCount}` : ""}`}
              </Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setSelected({}); setQuery(""); }}>Cancel</Button>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y">
              {searching && results.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Searching…</p>
              ) : results.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No contacts found. Import contacts first, or refine your search.</p>
              ) : (
                results.map((c) => {
                  const already = memberIds.has(c.id);
                  const isSel = !!selected[c.id];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={already}
                      onClick={() => toggleSelect(c)}
                      className={`flex w-full items-center justify-between gap-2 p-2.5 text-left text-sm ${already ? "opacity-50 cursor-not-allowed" : "hover:bg-accent/40"}`}
                    >
                      <span>
                        <span className="font-medium">{c.name || c.phoneE164}</span>
                        {c.name && <span className="text-muted-foreground"> · {c.phoneE164}</span>}
                      </span>
                      {already ? (
                        <span className="text-xs text-muted-foreground">Already in list</span>
                      ) : (
                        <span className={`flex h-5 w-5 items-center justify-center rounded border ${isSel ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                          {isSel && <Check className="h-3.5 w-3.5" />}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members */}
      {members.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="No contacts in this list yet"
            description="Use “Add contacts” above to search and add them, or assign contacts to this list during import."
          />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  <span className="font-medium">{m.name || m.phoneE164}</span>
                  {m.name && <span className="text-muted-foreground"> · {m.phoneE164}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeMember(m)}
                  title="Remove from list"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
