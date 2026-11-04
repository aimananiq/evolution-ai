"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Megaphone, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Totals = { queued: number; sending: number; sent: number; delivered: number; read: number; failed: number };
type FilterType = "all" | "not_sent" | "failed" | "sent";
type TargetRow = { id: string; name: string; phone: string; status: string; instanceLabel: string | null; error: string | null; sentAt: string | null };
type ByInstance = { instanceId: string; label: string; sent: number; failed: number };
type Report = { targets: TargetRow[]; total: number; byInstance: ByInstance[] };
type Bcast = {
  status: string;
  intervalMinSec: number | null;
  intervalMaxSec: number | null;
  instanceGroupId: string | null;
  groupSendMode: string | null;
  instanceId: string | null;
};
type InstanceOpt = { id: string; label: string; connectionState: string };
type GroupOpt = { id: string; name: string; members: { instanceId: string }[] };

type RetryScope = "failed" | "remaining";
type SendMode = "single" | "group";
type SpeedPreset = "low" | "medium" | "high" | "custom";

const SPEED_PRESETS: Record<Exclude<SpeedPreset, "custom">, { min: number; max: number }> = {
  low: { min: 45, max: 90 },
  medium: { min: 20, max: 45 },
  high: { min: 8, max: 20 },
};

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (h === 0 && m === 0) parts.push(`${rem}s`);
  return parts.join(" ");
}

export default function DetailView({
  workspaceSlug, broadcastId, initial,
}: {
  workspaceSlug: string; broadcastId: string;
  initial: { name: string; status: string; listName: string; instanceLabel: string; templateName: string | null; scheduledAt: string | null };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [status, setStatus] = useState(initial.status);
  const [totals, setTotals] = useState<Totals>({ queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
  const [bcast, setBcast] = useState<Bcast | null>(null);

  // Retry modal + instance/group options
  const [retryOpen, setRetryOpen] = useState(false);
  const [instances, setInstances] = useState<InstanceOpt[]>([]);
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [scope, setScope] = useState<RetryScope>("failed");
  const [sendMode, setSendMode] = useState<SendMode>("single");
  const [selInstanceId, setSelInstanceId] = useState<string>("");
  const [selGroupId, setSelGroupId] = useState<string>("");
  const [groupSendMode, setGroupSendMode] = useState<"parallel" | "rotate">("rotate");
  const [rotateEvery, setRotateEvery] = useState<number>(1);
  const [speed, setSpeed] = useState<SpeedPreset>("medium");
  const [customMin, setCustomMin] = useState<number>(20);
  const [customMax, setCustomMax] = useState<number>(45);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Report table state
  const [filter, setFilter] = useState<FilterType>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report>({ targets: [], total: 0, byInstance: [] });

  const qRef = useRef(q);
  qRef.current = q;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const pageRef = useRef(page);
  pageRef.current = page;

  async function fetchTargets(overrides?: { filter?: FilterType; q?: string; page?: number }) {
    const f = overrides?.filter ?? filterRef.current;
    const sq = overrides?.q ?? qRef.current;
    const pg = overrides?.page ?? pageRef.current;
    const res = await fetch(
      `/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/targets?status=${f}&q=${encodeURIComponent(sq)}&page=${pg}`
    );
    if (res.ok) setReport(await res.json());
  }

  async function refresh() {
    const res = await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}`);
    if (!res.ok) return;
    const { broadcast, totals } = await res.json();
    setStatus(broadcast.status);
    setBcast(broadcast);
    setTotals(totals);
    await fetchTargets();
  }

  async function loadSenders() {
    try {
      const [ir, gr] = await Promise.all([
        fetch(`/api/workspaces/${workspaceSlug}/instances`),
        fetch(`/api/workspaces/${workspaceSlug}/instance-groups`),
      ]);
      if (ir.ok) {
        const { instances } = await ir.json();
        setInstances(instances ?? []);
      }
      if (gr.ok) {
        const { groups } = await gr.json();
        setGroups((groups ?? []).filter((g: GroupOpt) => (g.members?.length ?? 0) >= 1));
      }
    } catch {
      /* ignore */
    }
  }

  function openRetry() {
    setNotice(null);
    // preselect current sender when easy
    if (bcast?.instanceGroupId) {
      setSendMode("group");
      setSelGroupId(bcast.instanceGroupId);
      if (bcast.groupSendMode === "parallel" || bcast.groupSendMode === "rotate") {
        setGroupSendMode(bcast.groupSendMode);
      }
    } else if (bcast?.instanceId) {
      setSendMode("single");
      setSelInstanceId(bcast.instanceId);
    }
    loadSenders();
    setRetryOpen(true);
  }

  async function pause() {
    await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/pause`, { method: "POST" });
    refresh();
  }

  async function resume() {
    await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/resume`, { method: "POST" });
    refresh();
  }

  async function resendTarget(targetId: string) {
    await fetch(
      `/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/targets/${targetId}/retry`,
      { method: "POST" }
    );
    refresh();
  }

  function exportFailed() {
    window.location.href = `/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/targets?status=failed&format=csv`;
  }

  async function submitRetry() {
    const interval =
      speed === "custom"
        ? { intervalMinSec: customMin, intervalMaxSec: customMax }
        : { intervalMinSec: SPEED_PRESETS[speed].min, intervalMaxSec: SPEED_PRESETS[speed].max };

    const body: Record<string, unknown> = { scope, ...interval };
    if (sendMode === "single") {
      if (selInstanceId) body.instanceId = selInstanceId;
    } else {
      if (selGroupId) {
        body.instanceGroupId = selGroupId;
        body.groupSendMode = groupSendMode;
        if (groupSendMode === "rotate") body.rotateEvery = rotateEvery;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) {
        const { requeued } = await res.json();
        setRetryOpen(false);
        setNotice(`${requeued} re-queued`);
        setTimeout(() => setNotice(null), 4000);
        refresh();
      } else {
        setNotice("Retry failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  // Re-fetch when filter or page changes (immediately)
  useEffect(() => {
    fetchTargets();
  }, [filter, page]);

  // Debounce q changes ~300ms; also reset page to 1
  useEffect(() => {
    const tid = setTimeout(() => {
      setPage(1);
      fetchTargets({ page: 1 });
    }, 300);
    return () => clearTimeout(tid);
  }, [q]);

  // Reset page to 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [filter]);

  async function start() {
    await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/start`, { method: "POST" });
    refresh();
    router.refresh();
  }

  async function cancel() {
    if (!confirm("Cancel this broadcast?")) return;
    await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcastId}/cancel`, { method: "POST" });
    refresh();
    router.refresh();
  }

  function statusLabel(s: string) {
    return t(`broadcasts.status${s[0]!.toUpperCase() + s.slice(1)}` as any);
  }

  function statusTone(s: string): "success" | "warning" | "danger" | "info" | "neutral" {
    if (s === "running") return "info";
    if (s === "completed") return "success";
    if (s === "failed" || s === "cancelled") return "danger";
    if (s === "scheduled" || s === "paused") return "warning";
    return "neutral";
  }

  function recipientStatusPill(s: string) {
    let cls = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ";
    if (s === "sent" || s === "delivered" || s === "read") cls += "bg-green-100 text-green-800";
    else if (s === "failed") cls += "bg-red-100 text-red-800";
    else if (s === "sending") cls += "bg-amber-100 text-amber-800";
    else cls += "bg-gray-100 text-gray-600";
    return <span className={cls}>{s}</span>;
  }

  function formatSentAt(v: string | null) {
    if (!v) return "—";
    try {
      return new Date(v).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return v;
    }
  }

  const canStart = status === "draft" || status === "scheduled" || status === "paused";
  const canCancel = status === "running" || status === "scheduled";

  // Progress + ETA
  const done = totals.sent + totals.delivered + totals.read + totals.failed;
  const inflight = totals.queued + totals.sending;
  const progressTotal = done + inflight;
  const progressPct = progressTotal > 0 ? Math.round((done / progressTotal) * 100) : 0;

  let etaLabel: string | null = null;
  if (
    status === "running" &&
    totals.queued > 0 &&
    bcast?.intervalMinSec != null &&
    bcast?.intervalMaxSec != null
  ) {
    const avgGapSec = (bcast.intervalMinSec + bcast.intervalMaxSec) / 2;
    let seconds = totals.queued * avgGapSec;
    if (bcast.groupSendMode === "parallel" && bcast.instanceGroupId) {
      const g = groups.find((gr) => gr.id === bcast.instanceGroupId);
      const members = g?.members?.length ?? 0;
      if (members > 1) seconds = seconds / members;
    }
    etaLabel = `≈ ${formatDuration(seconds)} remaining`;
  }

  const selectableGroups = groups; // already filtered to >=1 member on load

  const filterLabels: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "not_sent", label: "Not sent" },
    { key: "failed", label: "Failed" },
    { key: "sent", label: "Sent" },
  ];

  const visibleInstances = report.byInstance.filter(
    (b) => !(b.sent === 0 && b.failed === 0) && b.label && b.label !== "—"
  );

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={initial.name}
        icon={Megaphone}
        actions={<StatusPill tone={statusTone(status)}>{statusLabel(status)}</StatusPill>}
      />
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("broadcasts.pickInstance")}</dt><dd>{initial.instanceLabel}</dd>
        <dt className="text-muted-foreground">{t("broadcasts.pickList")}</dt><dd>{initial.listName}</dd>
        <dt className="text-muted-foreground">{t("broadcasts.pickTemplate")}</dt><dd>{initial.templateName ?? "—"}</dd>
        <dt className="text-muted-foreground">Status</dt><dd>{statusLabel(status)}</dd>
      </dl>
      <Card className="p-3 grid grid-cols-4 gap-2 text-center">
        <div><div className="text-xs text-muted-foreground">{t("broadcasts.queued")}</div><div className="text-xl font-semibold">{totals.queued}</div></div>
        <div><div className="text-xs text-muted-foreground">{t("broadcasts.sending")}</div><div className="text-xl font-semibold">{totals.sending}</div></div>
        <div><div className="text-xs text-muted-foreground">{t("broadcasts.sent")}</div><div className="text-xl font-semibold">{totals.sent + totals.delivered + totals.read}</div></div>
        <div><div className="text-xs text-muted-foreground">{t("broadcasts.failed")}</div><div className="text-xl font-semibold">{totals.failed}</div></div>
      </Card>
      {/* Progress bar + ETA */}
      {progressTotal > 0 && (
        <div className="space-y-1">
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {done} / {progressTotal} ({progressPct}%)
            </span>
            {etaLabel && <span>{etaLabel}</span>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canStart && <Button onClick={start}>{t("broadcasts.start")}</Button>}
        {canCancel && <Button variant="outline" onClick={cancel}>{t("broadcasts.cancel")}</Button>}
        {status === "running" && (
          <Button variant="outline" onClick={pause}>
            Pause
          </Button>
        )}
        {status === "paused" && (
          <>
            <Button onClick={resume}>Resume</Button>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              Paused
            </span>
          </>
        )}
        <Button variant="outline" onClick={openRetry}>
          Blast remaining / retry
        </Button>
        <Button variant="outline" onClick={exportFailed}>
          Export failed (CSV)
        </Button>
        {notice && <span className="text-sm text-green-600 font-medium">{notice}</span>}
      </div>

      {/* Per-number breakdown chips */}
      {visibleInstances.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleInstances.map((b) => (
            <span
              key={b.instanceId}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-muted text-muted-foreground border"
            >
              <span className="font-medium text-foreground">{b.label}</span>
              <span>·</span>
              <span>{b.sent} sent</span>
              {b.failed > 0 && (
                <>
                  <span>·</span>
                  <span className="text-red-600 font-medium">{b.failed} failed</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
          {filterLabels.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={
                "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                (filter === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or number…"
          className="flex-1 min-w-[180px] rounded-md border px-3 py-1.5 text-sm bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Report table */}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Number used</th>
              <th className="px-3 py-2 font-medium">Error</th>
              <th className="px-3 py-2 font-medium">Sent at</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {report.targets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No recipients in this view
                </td>
              </tr>
            ) : (
              report.targets.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{row.name || "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.phone}</td>
                  <td className="px-3 py-2">{recipientStatusPill(row.status)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.instanceLabel || "—"}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-red-600" title={row.error ?? undefined}>
                    {row.error ? row.error : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatSentAt(row.sentAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.status === "failed" && (
                      <Button variant="outline" size="sm" onClick={() => resendTarget(row.id)}>
                        Resend
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t text-sm text-muted-foreground">
          <span>
            Showing {report.targets.length} of {report.total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 50 >= report.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {/* Blast remaining / retry modal */}
      {retryOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRetryOpen(false)} />
          <Card className="relative z-10 w-full max-w-lg space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Blast remaining / retry</h2>
              <button
                type="button"
                onClick={() => setRetryOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scope */}
            <div className="space-y-1">
              <div className="text-sm font-medium">Scope</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="retry-scope"
                  checked={scope === "failed"}
                  onChange={() => setScope("failed")}
                />
                Retry failed only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="retry-scope"
                  checked={scope === "remaining"}
                  onChange={() => setScope("remaining")}
                />
                Blast all remaining (failed + not-yet-sent)
              </label>
            </div>

            {/* Send from */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Send from</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="send-mode"
                  checked={sendMode === "single"}
                  onChange={() => setSendMode("single")}
                />
                Single number
              </label>
              {sendMode === "single" && (
                <select
                  className="w-full border rounded p-2 text-sm bg-background"
                  value={selInstanceId}
                  onChange={(e) => setSelInstanceId(e.target.value)}
                >
                  <option value="">Auto / current sender</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} {i.connectionState !== "open" ? `(${i.connectionState})` : ""}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="send-mode"
                  checked={sendMode === "group"}
                  onChange={() => setSendMode("group")}
                />
                Group
              </label>
              {sendMode === "group" && (
                <div className="space-y-2">
                  <select
                    className="w-full border rounded p-2 text-sm bg-background"
                    value={selGroupId}
                    onChange={(e) => setSelGroupId(e.target.value)}
                  >
                    <option value="">Select a group…</option>
                    {selectableGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.members.length})
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1 rounded-lg border p-1 bg-muted/40 w-fit">
                    {(["parallel", "rotate"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setGroupSendMode(m)}
                        className={
                          "px-3 py-1 rounded-md text-sm font-medium transition-colors capitalize " +
                          (groupSendMode === m
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {groupSendMode === "rotate" && (
                    <label className="flex items-center gap-2 text-sm">
                      Rotate after
                      <input
                        type="number"
                        min={1}
                        value={rotateEvery}
                        onChange={(e) => setRotateEvery(Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 border rounded p-1 text-sm bg-background"
                      />
                      messages
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Speed presets */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Speed</div>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: "low", label: "Low (45–90s)" },
                  { key: "medium", label: "Medium (20–45s)" },
                  { key: "high", label: "High (8–20s)" },
                  { key: "custom", label: "Custom" },
                ] as { key: SpeedPreset; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSpeed(key)}
                    className={
                      "px-3 py-1 rounded-md text-sm font-medium border transition-colors " +
                      (speed === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground hover:text-foreground")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {speed === "custom" && (
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="number"
                    min={1}
                    value={customMin}
                    onChange={(e) => setCustomMin(Math.max(1, Number(e.target.value) || 1))}
                    className="w-24 border rounded p-1 bg-background"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={1}
                    value={customMax}
                    onChange={(e) => setCustomMax(Math.max(1, Number(e.target.value) || 1))}
                    className="w-24 border rounded p-1 bg-background"
                  />
                  <span className="text-muted-foreground">seconds between sends</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRetryOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={submitRetry}
                disabled={submitting || (sendMode === "group" && !selGroupId)}
              >
                {submitting ? "Working…" : "Confirm"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
