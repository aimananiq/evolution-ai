"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

type Sub = { id: string; url: string; events: string[]; enabled: boolean; createdAt: string };
type DeliveryLog = { id: string; event: string; url: string; ok: boolean; statusCode: number | null; error: string | null; createdAt: string };

const ALL_EVENTS = [
  "message.received",
  "message.sent",
  "message.status",
  "instance.state",
  "broadcast.completed",
  "broadcast.failed",
  "health.at_risk",
  "health.auto_protected",
  "health.ramp_cap_reached",
];

export default function WebhooksForm({ workspaceSlug, initial, logs = [] }: { workspaceSlug: string; initial: Sub[]; logs?: DeliveryLog[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["message.received"]);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function toggleEvent(ev: string) {
    setEvents(events.includes(ev) ? events.filter((e) => e !== ev) : [...events, ev]);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/webhook-subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, events }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setSecret(data.secret);
      setUrl("");
      setEvents(["message.received"]);
      router.refresh();
    }
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/workspaces/${workspaceSlug}/webhook-subscriptions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete subscription?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/webhook-subscriptions/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("webhooks.hint")}</p>
      <form onSubmit={create} className="border rounded-xl p-4 space-y-3">
        <label className="block">
          <span className="text-sm">{t("webhooks.urlLabel")}</span>
          <input
            className="w-full border rounded p-2 mt-1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://example.com/webhook"
          />
        </label>
        <fieldset className="space-y-1">
          <legend className="text-sm">{t("webhooks.eventsLabel")}</legend>
          {ALL_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
              <code className="text-xs">{ev}</code>
            </label>
          ))}
        </fieldset>
        <Button disabled={busy || !url || events.length === 0}>
          {t("webhooks.create")}
        </Button>
      </form>

      {secret && (
        <div className="border-l-4 border-warning/30 bg-warning/10 p-3 rounded-xl text-sm">
          <p className="font-medium">{t("webhooks.secretShown")}</p>
          <code className="font-mono text-xs break-all block mt-2">{secret}</code>
          <Button variant="ghost" size="sm" onClick={() => setSecret(null)} className="mt-2">
            {t("webhooks.dismiss")}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">URL</th>
                <th className="text-left p-2">{t("webhooks.eventsLabel")}</th>
                <th className="text-left p-2">{t("webhooks.statusLabel")}</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {initial.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2 break-all">
                    <code className="text-xs">{s.url}</code>
                  </td>
                  <td className="p-2 text-xs">{s.events.join(", ")}</td>
                  <td className="p-2">
                    <StatusPill tone={s.enabled ? "success" : "neutral"}>{s.enabled ? "active" : "paused"}</StatusPill>
                  </td>
                  <td className="p-2 space-x-1 whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => toggle(s.id, !s.enabled)}>
                      {s.enabled ? t("webhooks.pause") : t("webhooks.resume")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(s.id)} className="text-destructive hover:text-destructive">
                      {t("webhooks.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
              {initial.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-muted-foreground">
                    {t("webhooks.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium mb-2">{t("webhooks.recentDeliveries")}</h2>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y text-xs">
              {logs.map((l) => (
                <li key={l.id} className="p-2 flex items-center justify-between gap-2">
                  <span className={l.ok ? "text-success" : "text-destructive"}>{l.ok ? "✓" : "✗"}</span>
                  <code className="flex-1 truncate">{l.event}</code>
                  <span className="text-muted-foreground">{l.statusCode ?? l.error ?? ""}</span>
                  <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                </li>
              ))}
              {logs.length === 0 && <li className="p-2 text-muted-foreground">{t("webhooks.noDeliveries")}</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
