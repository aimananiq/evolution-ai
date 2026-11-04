"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

interface Instance { id: string; label: string }
interface Initial {
  id: string; name: string; description: string; instanceId: string; enabled: boolean;
  recipientPathKey: string; captionTemplate: string; webhookUrl: string; lastReceivedAt: string | null;
}
interface LogRow { id: string; resolvedPhone: string | null; status: string; error: string | null; createdAt: string }

export default function InboundEditor({ workspaceSlug, instances, initial }: { workspaceSlug: string; instances: Instance[]; initial: Initial }) {
  const t = useTranslations();
  const router = useRouter();
  const api = `/api/workspaces/${workspaceSlug}/inbound-integrations/${initial.id}`;

  const [enabled, setEnabled] = useState(initial.enabled);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [instanceId, setInstanceId] = useState(initial.instanceId);
  const [recipientPathKey, setRecipientPathKey] = useState(initial.recipientPathKey);
  const [caption, setCaption] = useState(initial.captionTemplate);
  const [paths, setPaths] = useState<string[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { void loadLogs(); }, []);
  async function loadLogs() {
    const res = await fetch(`${api}/logs`);
    if (res.ok) setLogs((await res.json()).logs);
  }

  async function save() {
    setSaveError(null);
    const res = await fetch(api, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, instanceId, enabled, recipientPathKey, captionTemplate: caption }),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error ?? "Save failed");
    }
  }

  async function remove() {
    if (!confirm("Delete this integration?")) return;
    const res = await fetch(api, { method: "DELETE" });
    if (res.ok) {
      router.push(`/${workspaceSlug}/integrations/inbound`);
    } else {
      const body = await res.json().catch(() => ({}));
      alert("Delete failed: " + (body.error ?? "error"));
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(initial.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function capture() {
    setCapturing(true);
    const armRes = await fetch(`${api}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arm: true }) });
    const baseline = armRes.ok ? (await armRes.json()).lastReceivedAt : initial.lastReceivedAt;
    const deadline = Date.now() + 120_000;
    const poll = async () => {
      const res = await fetch(`${api}/capture`);
      if (res.ok) {
        const data = await res.json();
        if (data.lastReceivedAt && data.lastReceivedAt !== baseline) {
          setPaths(data.paths ?? []);
          setCapturing(false);
          setCaptureSuccess(true);
          await fetch(`${api}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ arm: false }) });
          return;
        }
      }
      if (Date.now() < deadline) setTimeout(poll, 2000);
      else setCapturing(false);
    };
    setTimeout(poll, 2000);
  }

  async function sendTest() {
    setTestResult(null);
    const res = await fetch(`${api}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testTo }) });
    if (res.ok) {
      const body = await res.json();
      setTestResult(`Sent to ${body.sent?.to ?? testTo}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setTestResult("Failed: " + (body.detail ?? body.error ?? "error"));
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader icon={Webhook} title={t("inboundIntegrations.title")} description={t("inboundIntegrations.subtitle")} />

      <fieldset>
        <legend className="font-medium">{t("inboundIntegrations.status")}</legend>
        <label className="mr-4"><input type="radio" checked={enabled} onChange={() => setEnabled(true)} /> {t("inboundIntegrations.enable")}</label>
        <label><input type="radio" checked={!enabled} onChange={() => setEnabled(false)} /> {t("inboundIntegrations.disable")}</label>
      </fieldset>

      <label className="block">{t("inboundIntegrations.name")}
        <input className="mt-1 w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="block">{t("inboundIntegrations.description")}
        <input className="mt-1 w-full rounded border px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label className="block">{t("inboundIntegrations.selectAccount")}
        <select className="mt-1 w-full rounded border px-3 py-2" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      <div>
        <div className="font-medium">{t("inboundIntegrations.webhookUrl")}</div>
        <div className="mt-1 flex gap-2">
          <input className="w-full rounded border bg-muted px-3 py-2 text-sm" readOnly value={initial.webhookUrl} />
          <Button onClick={copyUrl}>{copied ? t("inboundIntegrations.copied") : t("inboundIntegrations.copy")}</Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("inboundIntegrations.webhookHint")}</p>
        <Button className="mt-2" onClick={capture} disabled={capturing}>
          {capturing ? t("inboundIntegrations.capturing") : t("inboundIntegrations.captureResponse")}
        </Button>
        {captureSuccess && <p className="mt-1 text-sm text-success">{t("inboundIntegrations.captured")}</p>}
      </div>

      <label className="block">{t("inboundIntegrations.recipientKey")}
        <input className="mt-1 w-full rounded border px-3 py-2" placeholder="billing.billing_phone" value={recipientPathKey} onChange={(e) => setRecipientPathKey(e.target.value)} />
        <span className="text-xs text-destructive">{t("inboundIntegrations.recipientKeyHint")}</span>
      </label>

      <div>
        <div className="font-medium">{t("inboundIntegrations.caption")}</div>
        <WhatsAppRichEditor
          value={caption}
          onChange={(v) => setCaption(v)}
          placeholder={t("inboundIntegrations.captionPlaceholder")}
          variables={paths.map((p) => ({ label: p, value: p }))}
          minRows={4}
        />
      </div>

      <div>
        <div className="font-medium">{t("inboundIntegrations.sendTest")}</div>
        <div className="mt-1 flex gap-2">
          <input className="w-full rounded border px-3 py-2" placeholder={t("inboundIntegrations.testRecipient")} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="outline" onClick={sendTest}>{t("inboundIntegrations.send")}</Button>
        </div>
        {testResult && <p className={`mt-1 text-sm ${testResult.startsWith("Failed") ? "text-destructive" : "text-success"}`}>{testResult}</p>}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => router.push(`/${workspaceSlug}/integrations/inbound`)}>{t("inboundIntegrations.back")}</Button>
        <div className="flex gap-2">
          <Button variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={remove}>{t("inboundIntegrations.delete")}</Button>
          <Button onClick={save}>{t("inboundIntegrations.save")}</Button>
        </div>
      </div>
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div>
        <div className="font-medium">{t("inboundIntegrations.logs")}</div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("inboundIntegrations.logEmpty")}</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <thead><tr className="text-left text-muted-foreground">
              <th>{t("inboundIntegrations.colWhen")}</th><th>{t("inboundIntegrations.colPhone")}</th><th>{t("inboundIntegrations.colStatus")}</th><th>{t("inboundIntegrations.colError")}</th>
            </tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td>{new Date(l.createdAt).toLocaleString()}</td><td>{l.resolvedPhone ?? "—"}</td><td>{l.status}</td><td className="text-destructive">{l.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
