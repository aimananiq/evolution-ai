"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Instance = { id: string; label: string };

export default function ChatwootForm({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [enabled, setEnabled] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    fetch(`/api/workspaces/${workspaceSlug}/integrations/chatwoot?instanceId=${instanceId}`).then(async (r) => {
      if (r.ok) {
        const { config, enabled } = await r.json();
        if (config) {
          setEnabled(Boolean(enabled));
          setAccountId(String(config.accountId ?? ""));
          setToken(""); // never prefill token from server
          setHasToken(Boolean(config.hasToken));
          setUrl(String(config.url ?? ""));
        } else {
          setToken("");
          setHasToken(false);
        }
      }
    });
  }, [workspaceSlug, instanceId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = {
      instanceId,
      enabled,
      accountId,
      url,
      signMsg: true,
      reopenConversation: true,
    };
    // Only include token if the user typed one; omit it when hasToken and field is empty
    if (token.length > 0) {
      body.token = token;
    }
    const res = await fetch(`/api/workspaces/${workspaceSlug}/integrations/chatwoot`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback("Saved");
      setHasToken(true);
      setToken("");
    } else {
      setFeedback("Failed");
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 border rounded-xl p-4">
      <label className="block">
        <span className="text-sm">Instance</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      <label className="block"><span className="text-sm">Account ID</span><input className="w-full border rounded p-2 mt-1" value={accountId} onChange={(e) => setAccountId(e.target.value)} required /></label>
      <label className="block">
        <span className="text-sm">Token</span>
        {hasToken && token.length === 0 && (
          <p className="text-xs text-muted-foreground">A token is already stored. Leave blank to keep it, or enter a new one to replace.</p>
        )}
        <input type="password" className="w-full border rounded p-2 mt-1" value={token} onChange={(e) => setToken(e.target.value)} required={!hasToken} />
      </label>
      <label className="block"><span className="text-sm">Chatwoot URL</span><input className="w-full border rounded p-2 mt-1" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://app.chatwoot.com" /></label>
      <Button disabled={busy}>Save</Button>
      {feedback && <p className="text-sm">{feedback}</p>}
    </form>
  );
}
