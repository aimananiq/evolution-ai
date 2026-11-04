"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Instance = { id: string; label: string };
type Group = { id: string; subject?: string };

export default function ExportPanel({ workspaceSlug, instances }: { workspaceSlug: string; instances: Instance[] }) {
  const t = useTranslations("exportParticipants");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [source, setSource] = useState<"contacts" | "group" | "lid">("contacts");
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupJid, setGroupJid] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function copyJid() {
    navigator.clipboard?.writeText(groupJid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Load groups when instance or source changes
  useEffect(() => {
    if (source !== "group" || !instanceId) return;
    setLoadingGroups(true);
    setErr(null);
    fetch(`/api/workspaces/${workspaceSlug}/groups?instanceId=${instanceId}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      const g: Group[] = d.groups ?? [];
      setGroups(g);
      setGroupJid(g[0]?.id ?? "");
      if (d.error === "INSTANCE_NOT_CONNECTED") {
        setErr("This number isn't connected to WhatsApp. Reconnect it on the Instances page, then try again.");
      } else if (d.error) {
        setErr("Couldn't load groups for this number — please try again in a moment.");
      }
      setLoadingGroups(false);
    }).catch(() => { setErr("Couldn't load groups — please try again."); setLoadingGroups(false); });
  }, [workspaceSlug, instanceId, source]);

  async function download() {
    setDownloading(true);
    setErr(null);
    try {
      let url = `/api/workspaces/${workspaceSlug}/export-participants?source=${source}`;
      if (source === "group") {
        if (!instanceId || !groupJid) { setErr("Select an instance and group first"); setDownloading(false); return; }
        url += `&instanceId=${encodeURIComponent(instanceId)}&groupJid=${encodeURIComponent(groupJid)}`;
      } else if (source === "lid") {
        if (!instanceId) { setErr("Select an instance first"); setDownloading(false); return; }
        url += `&instanceId=${encodeURIComponent(instanceId)}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Export failed");
        setDownloading(false);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "export.csv";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Instance selector (only needed for group export) */}
      <label className="block">
        <span className="text-sm font-medium">{t("instance")}</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      {/* Source radio */}
      <fieldset>
        <legend className="text-sm font-medium mb-1">{t("sourceLabel")}</legend>
        <div className="flex flex-wrap gap-4">
          {(["contacts", "group", "lid"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} />
              {s === "contacts" ? t("sourceContacts") : s === "group" ? t("sourceGroup") : "LID map (phone ↔ username)"}
            </label>
          ))}
        </div>
      </fieldset>

      {source === "lid" && (
        <p className="text-sm text-muted-foreground">
          Exports everyone who has <strong>messaged the selected number</strong>, with their WhatsApp
          <strong> LID</strong> (username) and real phone — captured automatically from incoming messages.
          Use it to resolve phone-hidden group members: match the <code className="rounded bg-muted px-1">lid</code> column
          against your Group Participants export.
        </p>
      )}

      {/* Group picker (shown only when group source selected) */}
      {source === "group" && (
        <label className="block">
          <span className="text-sm font-medium">{t("groupLabel")}</span>
          {loadingGroups ? (
            <p className="text-sm text-muted-foreground mt-1">{t("loadingGroups")}</p>
          ) : (
            <select className="w-full border rounded p-2 mt-1" value={groupJid} onChange={(e) => setGroupJid(e.target.value)}>
              {groups.length === 0 && <option value="">{t("noGroups")}</option>}
              {groups.map((g) => <option key={g.id} value={g.id}>{g.subject ?? g.id}</option>)}
            </select>
          )}
          {groupJid && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Group ID (JID):</span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{groupJid}</code>
              <button type="button" onClick={copyJid} className="underline hover:text-foreground">
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <span className="text-muted-foreground/70">— use this in the export/automation API.</span>
            </div>
          )}
        </label>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Button
        onClick={download}
        disabled={downloading || (source === "group" && !groupJid)}
      >
        {downloading ? t("downloading") : t("download")}
      </Button>
    </div>
  );
}
