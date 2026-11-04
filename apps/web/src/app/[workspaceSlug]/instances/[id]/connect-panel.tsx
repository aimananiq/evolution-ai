"use client";
import { useState } from "react";
import Link from "next/link";
import { Copy, Check, KeyRound } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      title="Copy"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-3 rounded-md border border-border bg-background p-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <CopyBtn value={value} />
      </div>
    </div>
  );
}

function CodeBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CopyBtn value={value} label="Copy" />
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">{value}</pre>
    </div>
  );
}

export function ConnectPanel({
  workspaceSlug,
  origin,
  instanceName,
  keyCount,
  canCreateKey,
  children,
}: {
  workspaceSlug: string;
  origin: string;
  instanceName: string;
  keyCount: number;
  canCreateKey: boolean;
  children?: React.ReactNode;
}) {
  const sendUrl = `${origin}/api/workspaces/${workspaceSlug}/instances/${instanceName}/send`;
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function createKey() {
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/api-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "n8n / API" }),
      });
      if (!res.ok) {
        setErr("Could not create a key — you may need Admin access.");
      } else {
        const j = await res.json();
        setToken(j.token ?? null);
      }
    } catch {
      setErr("Could not create a key. Please try again.");
    }
    setCreating(false);
  }

  const bearer = token ?? "ek_YOUR_KEY";
  const textBody = `{\n  "number": "60123456789",\n  "text": "Hello 👋"\n}`;
  const imageBody = `{\n  "number": "60123456789",\n  "type": "image",\n  "media_url": "https://your-domain/photo.png",\n  "message": "Hi with a picture 📸"\n}`;
  const curl = `curl -X POST "${sendUrl}" \\\n  -H "Authorization: Bearer ${bearer}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"number":"60123456789","type":"image","media_url":"https://your-domain/photo.png","message":"Hi 📸"}'`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to n8n / automations</CardTitle>
        <p className="text-xs text-muted-foreground">
          Everything needed to send from this number over HTTP — copy and paste into an HTTP Request node.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Row label="Send URL — method POST" value={sendUrl} />

        <div>
          <div className="mb-1 text-xs text-muted-foreground">API key</div>
          {token ? (
            <div className="space-y-2 rounded-md border border-success/40 bg-success/10 p-3">
              <div className="flex items-center gap-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{token}</code>
                <CopyBtn value={token} label="Copy" />
              </div>
              <p className="text-xs text-muted-foreground">
                Shown once — copy and store it safely. This key works for your whole workspace.
              </p>
            </div>
          ) : canCreateKey ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={createKey} disabled={creating}>
                <KeyRound className="h-4 w-4" />
                {creating ? "Creating…" : "Create API key"}
              </Button>
              <span className="text-xs text-muted-foreground">
                You have {keyCount} key{keyCount === 1 ? "" : "s"} ·{" "}
                <Link href={`/${workspaceSlug}/settings/api-keys`} className="text-primary underline">
                  Manage
                </Link>
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Ask an admin to create an API key in{" "}
              <Link href={`/${workspaceSlug}/settings/api-keys`} className="text-primary underline">
                Settings → API keys
              </Link>
              .
            </p>
          )}
          {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
        </div>

        <Row label="Header" value={`Authorization: Bearer ${bearer}`} />

        <CodeBox label="Body — text message" value={textBody} />
        <CodeBox label="Body — image (or video / document / audio)" value={imageBody} />

        <div>
          <Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(curl)}>
            Copy as cURL
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            A complete ready-to-run command{token ? " (with your new key)" : " — replace ek_YOUR_KEY with your key"}.
          </p>
        </div>

        {children && (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              Advanced — direct engine access (most people don&apos;t need this)
            </summary>
            <div className="mt-3">{children}</div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
