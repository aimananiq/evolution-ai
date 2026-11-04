"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Plus, Search, Trash2 } from "lucide-react";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type Item = { id: string; name: string; body: string };

export default function CaptionsForm({ workspaceSlug, initialItems }: { workspaceSlug: string; initialItems: Item[] }) {
  const t = useTranslations("captions");
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initialItems.length === 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, body }),
    });
    setBusy(false);
    if (res.ok) {
      const { item } = await res.json();
      setItems((x) => [...x, item].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setBody("");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error === "DUPLICATE" ? t("duplicate") : t("saveError"));
    }
  }

  async function remove(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    await fetch(`/api/workspaces/${workspaceSlug}/captions/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  const filtered = items.filter(
    (i) => i.name.toLowerCase().includes(q.toLowerCase()) || i.body.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full border rounded p-2 pl-8"
            placeholder={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus />
          {t("addNew")}
        </Button>
      </div>

      {showForm && (
        <Card className="p-3">
          <form onSubmit={add} className="space-y-2">
            <input
              className="w-full border rounded p-2"
              placeholder={t("name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
            <WhatsAppRichEditor value={body} onChange={(v) => setBody(v)} placeholder={t("body")} minRows={3} />
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
          </form>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title={t("empty")} />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {filtered.map((it) => (
            <div key={it.id} className="p-3 flex justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{it.name}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{it.body}</div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigator.clipboard?.writeText(it.body)}
                  title={t("copy")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(it.id)}
                  className="text-destructive hover:text-destructive"
                  title={t("delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
