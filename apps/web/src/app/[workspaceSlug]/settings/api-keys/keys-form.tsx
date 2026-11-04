"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Key = { id: string; name: string; lastUsedAt: string | null; createdAt: string };

export default function KeysForm({ workspaceSlug, initial }: { workspaceSlug: string; initial: Key[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/api-keys`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (res.ok) {
      const { id, name: keyName, token } = await res.json();
      setItems((x) => [{ id, name: keyName, lastUsedAt: null, createdAt: new Date().toISOString() }, ...x]);
      setToken(token);
      setName("");
      router.refresh();
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/api-keys/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex gap-2 items-end border rounded-xl p-3">
        <input className="flex-1 border rounded p-2" placeholder={t("apiKeys.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <Button disabled={busy}>{t("apiKeys.create")}</Button>
      </form>
      {token && (
        <div className="border-2 border-warning/30 bg-warning/10 rounded-xl p-3 space-y-2">
          <p className="text-sm font-semibold">{t("apiKeys.newKeyShown")}</p>
          <code className="block bg-card border rounded p-2 text-xs break-all">{token}</code>
          <Button variant="ghost" size="sm" onClick={() => setToken(null)}>Dismiss</Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((k) => (
              <li key={k.id} className="p-3 flex justify-between items-center text-sm">
                <span><strong>{k.name}</strong> <span className="text-xs text-muted-foreground">· {t("apiKeys.lastUsed")}: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-GB") : t("apiKeys.never")}</span></span>
                <Button variant="ghost" size="sm" onClick={() => revoke(k.id)} className="text-destructive hover:text-destructive">{t("apiKeys.delete")}</Button>
              </li>
            ))}
            {items.length === 0 && <li className="p-3 text-muted-foreground text-sm">—</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
