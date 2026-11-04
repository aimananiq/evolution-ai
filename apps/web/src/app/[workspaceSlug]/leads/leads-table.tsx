"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

type FunnelLead = {
  phone: string;
  name: string | null;
  interactions: number;
  firstSeen: string;
  lastSeen: string;
};

type DegradedLead = {
  contactPhone: string;
  contactName: string | null;
  lastMessageAt: string;
  unreadCount: number;
  status: string;
};

type LeadsResponse =
  | { mode: "funnel"; leads: FunnelLead[] }
  | { mode: "degraded"; leads: DegradedLead[] };

export default function LeadsTable({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations("leads");
  const [data, setData] = useState<LeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/leads`).then(async (r) => {
      if (r.ok) {
        setData(await r.json());
      } else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error ?? "Failed to load leads");
      }
      setLoading(false);
    }).catch((e) => { setErr(String(e)); setLoading(false); });
  }, [workspaceSlug]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {data.mode === "degraded" && (
        <div className="rounded border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t("degradedBanner")}
        </div>
      )}

      {data.mode === "funnel" ? (
        <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">{t("phone")}</th>
              <th className="text-left p-2">{t("name")}</th>
              <th className="text-left p-2">{t("interactions")}</th>
              <th className="text-left p-2">{t("lastActivity")}</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((lead, i) => (
              <tr key={i} className="border-t">
                <td className="p-2 font-mono text-xs">{lead.phone}</td>
                <td className="p-2">{lead.name ?? "—"}</td>
                <td className="p-2">{lead.interactions}</td>
                <td className="p-2">{lead.lastSeen ? new Date(lead.lastSeen).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {data.leads.length === 0 && (
              <tr><td colSpan={4} className="p-0"><EmptyState icon={Inbox} title={t("noLeads")} /></td></tr>
            )}
          </tbody>
        </table>
        </Card>
      ) : (
        <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">{t("phone")}</th>
              <th className="text-left p-2">{t("name")}</th>
              <th className="text-left p-2">{t("status")}</th>
              <th className="text-left p-2">{t("lastActivity")}</th>
            </tr>
          </thead>
          <tbody>
            {data.leads.map((lead, i) => (
              <tr key={i} className="border-t">
                <td className="p-2 font-mono text-xs">{lead.contactPhone}</td>
                <td className="p-2">{lead.contactName ?? "—"}</td>
                <td className="p-2"><StatusPill tone="neutral">{lead.status}</StatusPill></td>
                <td className="p-2">{lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {data.leads.length === 0 && (
              <tr><td colSpan={4} className="p-0"><EmptyState icon={Inbox} title={t("noLeads")} /></td></tr>
            )}
          </tbody>
        </table>
        </Card>
      )}
    </div>
  );
}
