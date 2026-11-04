"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check, Eye, EyeOff } from "lucide-react";

function CopyButton({ value }: { value: string }) {
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
      className="shrink-0 text-muted-foreground hover:text-foreground"
      title="Copy"
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function InstanceCredentials({
  instanceName,
  apiKey,
}: {
  instanceName: string;
  apiKey?: string | null;
}) {
  const t = useTranslations();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded border divide-y text-sm">
      <div className="flex items-center gap-3 p-3">
        <span className="w-40 shrink-0 text-muted-foreground">{t("instances.evoName")}</span>
        <code className="flex-1 min-w-0 truncate font-mono text-xs">{instanceName}</code>
        <CopyButton value={instanceName} />
      </div>
      {apiKey != null && (
        <div className="flex items-center gap-3 p-3">
          <span className="w-40 shrink-0 text-muted-foreground">{t("instances.apiKey")}</span>
          <code className="flex-1 min-w-0 truncate font-mono text-xs">
            {revealed ? apiKey : "•".repeat(Math.min(apiKey.length, 32))}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={revealed ? t("instances.hide") : t("instances.reveal")}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <CopyButton value={apiKey} />
        </div>
      )}
    </div>
  );
}
