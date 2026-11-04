"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

interface Row { id: string; name: string; enabled: boolean; lastReceivedAt: string | null }
interface Instance { id: string; label: string }

export default function InboundList({ workspaceSlug, instances, initial }: { workspaceSlug: string; instances: Instance[]; initial: Row[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [rows] = useState<Row[]>(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!instances[0]) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/inbound-integrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId: instances[0].id }),
    });
    setBusy(false);
    if (res.ok) {
      const { integration } = await res.json();
      router.push(`/${workspaceSlug}/integrations/inbound/${integration.id}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create integration");
    }
  }

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <input className="rounded-md border px-3 py-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={add} disabled={busy || instances.length === 0}>
          <Plus /> {t("inboundIntegrations.addNew")}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={Webhook} title={t("inboundIntegrations.empty")} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {filtered.map((r) => (
                <li key={r.id} className="flex items-center justify-between p-3 hover:bg-accent">
                  <button className="flex items-center gap-2 text-left" onClick={() => router.push(`/${workspaceSlug}/integrations/inbound/${r.id}`)}>
                    <div>
                      <div className="font-medium">{r.name}</div>
                    </div>
                    <StatusPill tone={r.enabled ? "success" : "neutral"}>
                      {r.enabled ? t("inboundIntegrations.enable") : t("inboundIntegrations.disable")}
                    </StatusPill>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
