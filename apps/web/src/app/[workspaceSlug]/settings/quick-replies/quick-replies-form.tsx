"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Item = { id: string; shortcut: string; body: string };

export default function QuickRepliesForm({ workspaceSlug, initialItems }: { workspaceSlug: string; initialItems: Item[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/quick-replies`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcut, body }),
    });
    setBusy(false);
    if (res.ok) {
      const { item } = await res.json();
      setItems((x) => [...x, item]);
      setShortcut("");
      setBody("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    if (!confirm(t("quickReplies.confirmDelete"))) return;
    await fetch(`/api/workspaces/${workspaceSlug}/quick-replies/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="space-y-2 border rounded-xl p-3">
        <input className="w-full border rounded p-2" placeholder={t("quickReplies.shortcut")} value={shortcut} onChange={(e) => setShortcut(e.target.value)} required maxLength={40} />
        <WhatsAppRichEditor
          value={body}
          onChange={(v) => setBody(v)}
          placeholder={t("quickReplies.body")}
          minRows={3}
        />
        <Button disabled={busy}>{t("quickReplies.add")}</Button>
      </form>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="p-3 flex justify-between gap-3">
                <div>
                  <div><strong>{it.shortcut}</strong></div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{it.body}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(it.id)} className="text-destructive hover:text-destructive">{t("common.delete")}</Button>
              </li>
            ))}
            {items.length === 0 && <li className="p-3 text-muted-foreground text-sm">—</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
