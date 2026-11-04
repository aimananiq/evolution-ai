"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Item = { id: string; title: string; content: string; enabled: boolean };

export default function KnowledgeForm({ workspaceSlug, initialItems }: { workspaceSlug: string; initialItems: Item[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [importTitle, setImportTitle] = useState("");
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function importDoc(e: React.FormEvent) {
    e.preventDefault();
    setImportBusy(true);
    setImportMsg(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/knowledge/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseTitle: importTitle || undefined, text: importText }),
    });
    setImportBusy(false);
    if (res.ok) {
      const { created } = await res.json();
      setImportMsg(t("knowledge.imported", { count: created }));
      setImportText("");
      setImportTitle("");
      const listRes = await fetch(`/api/workspaces/${workspaceSlug}/knowledge`);
      if (listRes.ok) setItems((await listRes.json()).items);
      router.refresh();
    } else {
      setImportMsg(t("knowledge.importFailed"));
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    setBusy(false);
    if (res.ok) {
      const { item } = await res.json();
      setItems((x) => [item, ...x]);
      setTitle("");
      setContent("");
      router.refresh();
    }
  }

  async function toggle(it: Item) {
    const res = await fetch(`/api/workspaces/${workspaceSlug}/knowledge/${it.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !it.enabled }),
    });
    if (res.ok) setItems((x) => x.map((i) => (i.id === it.id ? { ...i, enabled: !i.enabled } : i)));
  }

  async function remove(id: string) {
    if (!confirm(t("knowledge.confirmDelete"))) return;
    await fetch(`/api/workspaces/${workspaceSlug}/knowledge/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={importDoc} className="space-y-2 border rounded-xl p-3">
        <div className="text-sm font-medium">{t("knowledge.importTitle")}</div>
        <input
          className="w-full border rounded p-2"
          placeholder={t("knowledge.importBaseTitle")}
          value={importTitle}
          onChange={(e) => setImportTitle(e.target.value)}
          maxLength={120}
        />
        <textarea
          className="w-full border rounded p-2 min-h-[120px]"
          placeholder={t("knowledge.importPlaceholder")}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          maxLength={100000}
        />
        <div className="flex items-center gap-3">
          <Button disabled={importBusy || !importText.trim()}>
            {t("knowledge.import")}
          </Button>
          {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
        </div>
      </form>

      <form onSubmit={add} className="space-y-2 border rounded-xl p-3">
        <input
          className="w-full border rounded p-2"
          placeholder={t("knowledge.snippetTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={120}
        />
        <textarea
          className="w-full border rounded p-2 min-h-[100px]"
          placeholder={t("knowledge.content")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          maxLength={5000}
        />
        <Button disabled={busy}>
          {t("knowledge.add")}
        </Button>
      </form>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="p-3 flex justify-between gap-3">
                <div className={it.enabled ? "" : "opacity-50"}>
                  <div><strong>{it.title}</strong></div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{it.content}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
                  <Button variant="ghost" size="sm" onClick={() => toggle(it)} className="text-muted-foreground">
                    {it.enabled ? t("knowledge.disable") : t("knowledge.enable")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(it.id)} className="text-destructive hover:text-destructive">
                    {t("common.delete")}
                  </Button>
                </div>
              </li>
            ))}
            {items.length === 0 && <li className="p-3 text-muted-foreground text-sm">{t("knowledge.empty")}</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
