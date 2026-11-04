"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

type LogRow = {
  id: string;
  kind: string;
  detail: unknown;
  createdAt: string;
};

const KIND_OPTIONS = [
  { value: "", label: "All" },
  { value: "trigger_matched", label: "Trigger matched" },
  { value: "ai_reply", label: "AI reply" },
  { value: "auto_label", label: "Auto label" },
  { value: "human_takeover", label: "Human takeover" },
  { value: "follow_up_sent", label: "Follow-up sent" },
  { value: "action_run", label: "Action run" },
];

export default function LogsTable({
  workspaceSlug,
  chatbotId,
  initialLogs,
}: {
  workspaceSlug: string;
  chatbotId: string;
  initialLogs: LogRow[];
}) {
  const t = useTranslations();
  const [logs, setLogs] = useState<LogRow[]>(initialLogs);
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(false);

  async function fetchLogs(newKind: string) {
    setLoading(true);
    try {
      const url = new URL(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/logs`, window.location.origin);
      if (newKind) url.searchParams.set("kind", newKind);
      const res = await fetch(url.toString());
      if (res.ok) {
        const { logs: rows } = await res.json();
        setLogs(rows.map((l: any) => ({ ...l, createdAt: l.createdAt })));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKindChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setKind(v);
    void fetchLogs(v);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm">
          {t("aiActions.logKind")}:
        </label>
        <select
          className="border rounded p-1 text-sm"
          value={kind}
          onChange={handleKindChange}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("aiActions.noLogs")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("aiActions.logTime")}</th>
                <th className="py-2 pr-4 font-medium">{t("aiActions.logKind")}</th>
                <th className="py-2 font-medium">{t("aiActions.logDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b hover:bg-accent">
                  <td className="py-2 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="inline-block bg-muted rounded px-1.5 py-0.5 text-xs font-mono">
                      {log.kind}
                    </span>
                  </td>
                  <td className="py-2">
                    <pre className="text-xs whitespace-pre-wrap break-all text-muted-foreground max-w-xs">
                      {log.detail ? JSON.stringify(log.detail, null, 2) : "—"}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
