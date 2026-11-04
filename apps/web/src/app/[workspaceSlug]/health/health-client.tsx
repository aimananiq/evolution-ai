"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface Policy {
  rampEnabled: boolean;
  rampBaseDaily: number;
  rampGrowthPct: number;
  rampMaxDaily: number;
  autoProtect: boolean;
}

export function PolicyEditor({
  workspaceSlug, instanceId, initial, canEdit,
}: { workspaceSlug: string; instanceId: string; initial: Policy; canEdit: boolean }) {
  const t = useTranslations("health");
  const [p, setP] = useState<Policy>(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setSaved(false);
    await fetch(`/api/workspaces/${workspaceSlug}/health/instances/${instanceId}/policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    setBusy(false); setSaved(true);
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!canEdit} checked={p.rampEnabled}
          onChange={(e) => setP({ ...p, rampEnabled: e.target.checked })} />
        {t("rampEnabled")}
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampBaseDaily")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampBaseDaily} onChange={(e) => setP({ ...p, rampBaseDaily: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampGrowthPct")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampGrowthPct} onChange={(e) => setP({ ...p, rampGrowthPct: Number(e.target.value) })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        {t("rampMaxDaily")}
        <input type="number" className="w-24 border rounded px-2 py-1 bg-background" disabled={!canEdit}
          value={p.rampMaxDaily} onChange={(e) => setP({ ...p, rampMaxDaily: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!canEdit} checked={p.autoProtect}
          onChange={(e) => setP({ ...p, autoProtect: e.target.checked })} />
        {t("autoProtect")}
      </label>
      {canEdit && (
        <Button onClick={save} disabled={busy} size="sm">
          {saved ? t("saved") : t("save")}
        </Button>
      )}
    </div>
  );
}

export function AckButton({ workspaceSlug, alertId }: { workspaceSlug: string; alertId: string }) {
  const t = useTranslations("health");
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="link"
      onClick={async () => {
        await fetch(`/api/workspaces/${workspaceSlug}/health/alerts/${alertId}/ack`, { method: "POST" });
        setDone(true);
      }}
      disabled={done}
      className="h-auto p-0 text-xs"
    >
      {t("acknowledge")}
    </Button>
  );
}
