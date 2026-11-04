"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type Instance = { id: string; label: string };
type WaLabel = { id: string; name: string; color?: string | number; predefinedId?: string | null };

// Evolution/Baileys returns `color` as either a hex string or a WhatsApp palette
// index (0-19). Render the hex when given; otherwise derive a stable swatch.
function swatch(color?: string | number): string {
  if (typeof color === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color;
  const n = typeof color === "number" ? color : Number(color) || 0;
  return `hsl(${(n * 37) % 360} 70% 60%)`;
}

export default function LabelsPanel({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const t = useTranslations("waLabels");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [labels, setLabels] = useState<WaLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/wa-labels?instanceId=${encodeURIComponent(instanceId)}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "FETCH_FAILED"); setLabels([]); }
      else setLabels(Array.isArray(d.labels) ? d.labels : []);
    } catch {
      setErr("FETCH_FAILED");
      setLabels([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, instanceId]);

  useEffect(() => { load(); }, [load]);

  const filtered = labels.filter((l) => l.name?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-56">
          <span className="text-sm font-medium">{t("instance")}</span>
          <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            {instances.length === 0 && <option value="">{t("noInstances")}</option>}
            {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <input
          className="border rounded p-2 flex-1 min-w-40"
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button
          variant="outline"
          onClick={load}
          disabled={loading || !instanceId}
          title={t("refresh")}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {t("refresh")}
        </Button>
      </div>

      {err && <p className="text-sm text-destructive">{t("fetchError")}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr className="text-left">
              <th className="p-3 font-medium">{t("colLabelId")}</th>
              <th className="p-3 font-medium">{t("colName")}</th>
              <th className="p-3 font-medium">{t("colColor")}</th>
              <th className="p-3 font-medium">{t("colPredefined")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((l) => (
              <tr key={String(l.id)} className="hover:bg-secondary/30">
                <td className="p-3 font-mono text-xs">{l.id}</td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    {l.name || "—"}
                  </span>
                </td>
                <td className="p-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-6 rounded" style={{ backgroundColor: swatch(l.color) }} />
                    <span className="text-xs text-muted-foreground">{String(l.color ?? "—")}</span>
                  </span>
                </td>
                <td className="p-3 text-muted-foreground">{l.predefinedId ?? "—"}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={4} className="p-0"><EmptyState icon={Tag} title={t("empty")} /></td></tr>
            )}
            {loading && (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">{t("loading")}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
