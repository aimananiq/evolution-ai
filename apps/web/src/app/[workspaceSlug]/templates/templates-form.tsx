"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X, Trash2, FileText } from "lucide-react";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type T = { id: string; name: string; body: string };
type Editing = { id: string | null; name: string; body: string } | null;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? flat.slice(0, 90) + "…" : flat;
}

export default function TemplatesForm({ workspaceSlug, initial, customFieldKeys = [] }: { workspaceSlug: string; initial: T[]; customFieldKeys?: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const variables = [
    { label: "Name", value: "name" },
    { label: "Phone", value: "phone" },
    ...customFieldKeys.map((k) => ({ label: k, value: k })),
  ];
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openNew() { setError(null); setEditing({ id: null, name: "", body: "" }); }
  function openEdit(tpl: T) { setError(null); setEditing({ id: tpl.id, name: tpl.name, body: tpl.body }); }

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    const body = editing.body.trim();
    if (!name || !body) { setError("Name and message are both required."); return; }
    setBusy(true); setError(null);
    const isNew = editing.id === null;
    const res = await fetch(
      isNew ? `/api/workspaces/${workspaceSlug}/templates` : `/api/workspaces/${workspaceSlug}/templates/${editing.id}`,
      { method: isNew ? "POST" : "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, body }) },
    );
    setBusy(false);
    if (!res.ok) { setError("Could not save the template."); return; }
    const { template } = await res.json();
    setItems((x) => (isNew ? [...x, template] : x.map((i) => (i.id === template.id ? template : i))));
    setEditing(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/templates/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> {t("templates.new")}</Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title={t("templates.title")} description="Create a reusable message with {{name}} merge tags." />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium w-1/3">Name</th>
                <th className="p-3 font-medium">Preview</th>
                <th className="p-3 font-medium w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <tr key={i.id} className="align-top hover:bg-secondary/40 cursor-pointer" onClick={() => openEdit(i)}>
                  <td className="p-3 font-medium">{i.name}</td>
                  <td className="p-3 text-muted-foreground">{preview(i.body)}</td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(i.id)} title="Delete template">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Editor modal (create + edit) */}
      {editing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditing(null)} />
          <Card className="relative z-10 w-full max-w-lg space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing.id === null ? t("templates.new") : "Edit template"}</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input
              className="w-full border rounded p-2"
              placeholder={t("templates.name")}
              value={editing.name}
              onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))}
              maxLength={120}
              autoFocus
            />
            <WhatsAppRichEditor
              value={editing.body}
              onChange={(v) => setEditing((s) => (s ? { ...s, body: v } : s))}
              placeholder={t("templates.body")}
              variables={variables}
              minRows={5}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              {editing.id !== null ? (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => remove(editing.id!)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
