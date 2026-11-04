"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Instance = { id: string; label: string; phoneNumber: string | null };

type ProfileInfo = {
  instanceId: string;
  accessToken: string;
  phoneNumber: string | null;
  profileName: string | null;
  profilePictureUrl: string | null;
  evolutionPort: string | null;
};

type WebhookInfo = {
  enabled: boolean;
  url: string;
  byEvents: boolean;
  base64: boolean;
  events: string[];
};

const ALL_EVENTS = [
  "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE",
  "CONNECTION_UPDATE", "QRCODE_UPDATED", "CONTACTS_UPSERT", "CONTACTS_UPDATE",
  "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE", "PRESENCE_UPDATE",
];

export default function ProfilePanel({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const t = useTranslations("profile");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Profile edit state
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Webhook edit state
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookByEvents, setWebhookByEvents] = useState(false);
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookSaveMsg, setWebhookSaveMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    setLoading(true);
    setErr(null);
    setInfo(null);
    setWebhook(null);
    Promise.all([
      fetch(`/api/workspaces/${workspaceSlug}/profile?instanceId=${instanceId}`),
      fetch(`/api/workspaces/${workspaceSlug}/profile/webhook?instanceId=${instanceId}`),
    ]).then(async ([pr, wr]) => {
      if (pr.ok) {
        const d = await pr.json();
        setInfo(d);
        setEditName(d.profileName ?? "");
      } else {
        const d = await pr.json();
        setErr(d.error ?? "Failed to load profile");
      }
      if (wr.ok) {
        const d = await wr.json();
        const wh = (d.webhook as any)?.webhook ?? d.webhook;
        if (wh) {
          setWebhook({ enabled: wh.enabled ?? false, url: wh.url ?? "", byEvents: wh.byEvents ?? false, base64: wh.base64 ?? true, events: wh.events ?? [] });
          setWebhookEnabled(wh.enabled ?? false);
          setWebhookUrl(wh.url ?? "");
          setWebhookByEvents(wh.byEvents ?? false);
          setWebhookEvents(wh.events ?? []);
        }
      }
      setLoading(false);
    }).catch((e) => { setErr(String(e)); setLoading(false); });
  }, [workspaceSlug, instanceId]);

  async function saveProfile() {
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, name: editName || undefined, status: editStatus || undefined }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg(t("saved"));
      setTimeout(() => setSaveMsg(null), 3000);
    } else {
      const d = await res.json();
      setSaveMsg(`Error: ${d.error ?? "Failed"}`);
    }
  }

  async function saveWebhook() {
    setWebhookSaving(true);
    setWebhookSaveMsg(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/profile/webhook`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId,
        webhook: { enabled: webhookEnabled, url: webhookUrl, byEvents: webhookByEvents, base64: true, events: webhookEvents },
      }),
    });
    setWebhookSaving(false);
    if (res.ok) {
      setWebhookSaveMsg(t("webhookSaved"));
      setTimeout(() => setWebhookSaveMsg(null), 3000);
    } else {
      const d = await res.json();
      setWebhookSaveMsg(`Error: ${d.error ?? "Failed"}`);
    }
  }

  function copy(val: string, key: string) {
    navigator.clipboard.writeText(val);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function toggleEvent(ev: string) {
    setWebhookEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  }

  return (
    <div className="space-y-6">
      {/* Instance selector */}
      <label className="block">
        <span className="text-sm font-medium">{t("instance")}</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}{i.phoneNumber ? ` (${i.phoneNumber})` : ""}</option>)}
        </select>
      </label>

      {loading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {info && (
        <>
          {/* General Info card */}
          <Card>
            <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">{t("generalInfo")}</h2>
            {(info.profilePictureUrl || info.profileName) && (
              <div className="flex items-center gap-3">
                {info.profilePictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.profilePictureUrl} alt={info.profileName ?? ""} className="h-12 w-12 rounded-full object-cover" />
                )}
                {info.profileName && <p className="text-sm font-medium">{info.profileName}</p>}
              </div>
            )}
            {[
              { label: t("accessToken"), value: info.accessToken, key: "token" },
              { label: t("instanceIdLabel"), value: info.instanceId, key: "instanceId" },
              ...(info.evolutionPort ? [{ label: t("port"), value: info.evolutionPort, key: "port" }] : []),
              ...(info.phoneNumber ? [{ label: t("phone"), value: info.phoneNumber, key: "phone" }] : []),
            ].map(({ label, value, key }) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-mono break-all">{value}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(value, key)}
                  className="shrink-0"
                >
                  {copied === key ? t("copied") : t("copy")}
                </Button>
              </div>
            ))}
            </CardContent>
          </Card>

          {/* Profile edit card */}
          <Card>
            <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">{t("editProfile")}</h2>
            <label className="block">
              <span className="text-sm">{t("profileName")}</span>
              <input
                className="w-full border rounded p-2 mt-1 text-sm"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("profileNamePlaceholder")}
              />
            </label>
            <label className="block">
              <span className="text-sm">{t("profileStatus")}</span>
              <input
                className="w-full border rounded p-2 mt-1 text-sm"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                placeholder={t("profileStatusPlaceholder")}
              />
            </label>
            <div className="flex items-center gap-3">
              <Button
                onClick={saveProfile}
                disabled={saving}
              >
                {saving ? t("saving") : t("save")}
              </Button>
              {saveMsg && <span className="text-sm text-green-700">{saveMsg}</span>}
            </div>
            </CardContent>
          </Card>

          {/* Webhook card */}
          <Card>
            <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold text-sm uppercase text-muted-foreground">{t("webhookTitle")}</h2>
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {t("webhookWarning")}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={webhookEnabled} onChange={(e) => setWebhookEnabled(e.target.checked)} />
              {t("webhookEnabled")}
            </label>

            <label className="block">
              <span className="text-sm">{t("webhookUrl")}</span>
              <input
                className="w-full border rounded p-2 mt-1 text-sm font-mono"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={webhookByEvents} onChange={(e) => setWebhookByEvents(e.target.checked)} />
              {t("webhookByEvents")}
            </label>

            <div>
              <p className="text-sm mb-2">{t("webhookEvents")}</p>
              <div className="grid grid-cols-2 gap-1">
                {ALL_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={webhookEvents.includes(ev)} onChange={() => toggleEvent(ev)} />
                    {ev}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={saveWebhook}
                disabled={webhookSaving}
              >
                {webhookSaving ? t("saving") : t("webhookSave")}
              </Button>
              {webhookSaveMsg && <span className="text-sm text-green-700">{webhookSaveMsg}</span>}
            </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
