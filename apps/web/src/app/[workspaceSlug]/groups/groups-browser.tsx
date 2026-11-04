"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Instance = { id: string; label: string };
type Group = { id: string; subject?: string; size?: number; desc?: string };

export default function GroupsBrowser({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const t = useTranslations();
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    setLoading(true);
    setErr(null);
    fetch(`/api/workspaces/${workspaceSlug}/groups?instanceId=${instanceId}`).then(async (r) => {
      const data = await r.json();
      if (r.ok) setGroups(data.groups ?? []);
      else setErr(data.error ?? "Failed");
      setLoading(false);
    }).catch((e) => { setErr(String(e)); setLoading(false); });
  }, [workspaceSlug, instanceId]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm">{t("groups.instanceLabel")}</span>
        <select className="border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      {loading && <p className="text-sm text-muted-foreground">{t("groups.loading")}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      <table className="w-full text-sm border">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2">{t("groups.subject")}</th>
            <th className="text-left p-2">{t("groups.size")}</th>
            <th className="text-left p-2">JID</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} className="border-t">
              <td className="p-2">{g.subject ?? "—"}</td>
              <td className="p-2">{g.size ?? "—"}</td>
              <td className="p-2"><code className="text-xs">{g.id}</code></td>
            </tr>
          ))}
          {!loading && groups.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">{t("groups.empty")}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
