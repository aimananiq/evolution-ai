"use client";
import { useState, useEffect, useMemo } from "react";
import { ChevronDown, X, Copy, Check, SlidersHorizontal, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

export type ContactRow = {
  id: string;
  name: string | null;
  phoneE164: string;
  customFields: Record<string, string> | null;
  labels: { labelId: string; name: string; colour: string }[];
};

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="text-muted-foreground hover:text-foreground"
      title="Copy"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function ContactsView({ workspaceSlug, contacts }: { workspaceSlug: string; contacts: ContactRow[] }) {
  const allKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of contacts) if (c.customFields) for (const k of Object.keys(c.customFields)) s.add(k);
    return Array.from(s);
  }, [contacts]);

  const storageKey = `contacts-fields:${workspaceSlug}`;
  const [chosen, setChosen] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<ContactRow | null>(null);
  // Sorting: null = keep incoming order (most-recently-updated first).
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  function sortValue(c: ContactRow, key: string): string {
    if (key === "name") return c.name ?? c.phoneE164;
    if (key === "phone") return c.phoneE164;
    return c.customFields?.[key] ?? "";
  }

  const sorted = useMemo(() => {
    if (!sort) return contacts;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...contacts].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      // Empty values always sort to the bottom regardless of direction.
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      return factor * av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [contacts, sort]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears sort
    });
  }

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (saved) {
      try {
        setChosen(JSON.parse(saved));
        return;
      } catch {}
    }
    // Default: the first two "useful" fields (skip TRUE/FALSE flags and long values).
    const useful = allKeys.filter((k) => {
      const sample = contacts.find((c) => c.customFields?.[k])?.customFields?.[k] ?? "";
      return sample && !/^(true|false)$/i.test(sample) && sample.length <= 40;
    });
    setChosen(useful.slice(0, 2));
  }, [storageKey, allKeys, contacts]);

  function toggle(k: string) {
    setChosen((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  return (
    <>
      {allKeys.length > 0 && (
        <div className="relative flex justify-end">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-4 w-4" /> Fields
            <ChevronDown className="h-4 w-4" />
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-border bg-card p-2 shadow-lg">
                <div className="px-2 pb-1 text-xs text-muted-foreground">Shown under each name</div>
                {allKeys.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/60">
                    <input type="checkbox" checked={chosen.includes(k)} onChange={() => toggle(k)} />
                    <span className="truncate">{k}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              {([["name", "Name"], ["phone", "Phone"], ...chosen.map((k) => [k, k] as const)] as const).map(([col, label]) => {
                const active = sort?.key === col;
                return (
                  <th key={col} className="p-3 font-medium whitespace-nowrap">
                    <button type="button" onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
                      {label}
                      {active ? (sort!.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />}
                    </button>
                  </th>
                );
              })}
              <th className="p-3 font-medium">Labels</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => setSelected(c)}>
                <td className="p-3 font-medium">{c.name ?? c.phoneE164}</td>
                <td className="p-3 text-muted-foreground whitespace-nowrap">{c.phoneE164}</td>
                {chosen.map((k) => (
                  <td key={k} className="p-3 text-muted-foreground">{c.customFields?.[k] ?? ""}</td>
                ))}
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {c.labels.map((l) => (
                      <span key={l.labelId} style={{ background: l.colour }} className="rounded px-2 py-0.5 text-xs text-white">
                        {l.name}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selected.name ?? selected.phoneE164}</h2>
                <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{selected.phoneE164}</span>
                  <CopyBtn value={selected.phoneE164} />
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {selected.labels.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1">
                {selected.labels.map((l) => (
                  <span key={l.labelId} style={{ background: l.colour }} className="rounded px-2 py-0.5 text-xs text-white">
                    {l.name}
                  </span>
                ))}
              </div>
            )}

            {selected.customFields && Object.keys(selected.customFields).length > 0 ? (
              <dl className="space-y-2.5">
                {Object.entries(selected.customFields).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-2 border-b border-border pb-2 last:border-0">
                    <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
                    <dd className="col-span-2 break-words text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No extra fields imported for this contact.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
