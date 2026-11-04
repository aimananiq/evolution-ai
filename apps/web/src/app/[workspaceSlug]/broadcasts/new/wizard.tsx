"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaPicker } from "@/components/media-picker";

type DayPart = "daytime" | "nighttime" | "odd" | "even";

const DAY_PARTS: { value: DayPart; label: string }[] = [
  { value: "daytime", label: "Daytime (06:00–18:00)" },
  { value: "nighttime", label: "Nighttime (18:00–06:00)" },
  { value: "odd", label: "Odd days" },
  { value: "even", label: "Even days" },
];

type SpeedId = "low" | "medium" | "high" | "custom";

// Preset gaps (seconds) between messages. Slower = safer from WhatsApp bans.
// Even "high" is deliberately non-zero — a 0-gap blast is what gets numbers banned.
const SPEED_PRESETS: { id: SpeedId; label: string; min: number; max: number; dot: string; hint: string }[] = [
  { id: "low", label: "Low risk (safest)", min: 45, max: 90, dot: "🟢", hint: "~1 msg/min — safest from bans" },
  { id: "medium", label: "Medium (balanced)", min: 20, max: 45, dot: "🟡", hint: "~2 msg/min — a good default" },
  { id: "high", label: "High risk (fastest)", min: 8, max: 20, dot: "🔴", hint: "~4 msg/min — fast, higher ban risk" },
  { id: "custom", label: "Custom", min: 0, max: 0, dot: "⚙️", hint: "Set your own gap below" },
];

// True estimate: recipients × gap. Format seconds → "1d 2h 3m".
function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return "0m";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

export default function Wizard({ workspaceSlug, instances, lists, templates, groups = [] }: {
  workspaceSlug: string;
  instances: { id: string; label: string }[];
  lists: { id: string; name: string; members: number }[];
  templates: { id: string; name: string }[];
  groups?: { id: string; name: string; memberCount: number }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [fallbackInstanceIds, setFallbackInstanceIds] = useState<string[]>([]);
  const [sendFrom, setSendFrom] = useState<"single" | "group">("single");
  const [instanceGroupId, setInstanceGroupId] = useState(groups[0]?.id ?? "");
  const [groupSendMode, setGroupSendMode] = useState<"parallel" | "rotate">("parallel");
  const [rotateEvery, setRotateEvery] = useState(20);
  const selectedGroup = groups.find((g) => g.id === instanceGroupId);
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(null);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [jitterMinMs, setJitterMinMs] = useState(2000);
  const [jitterMaxMs, setJitterMaxMs] = useState(8000);
  // Default to the "medium" preset gap so nobody blasts at 0s by accident.
  const [speed, setSpeed] = useState<SpeedId>("medium");
  const [intervalMinSec, setIntervalMinSec] = useState<number | "">(20);
  const [intervalMaxSec, setIntervalMaxSec] = useState<number | "">(45);

  function pickSpeed(id: SpeedId) {
    setSpeed(id);
    const preset = SPEED_PRESETS.find((s) => s.id === id)!;
    if (id !== "custom") {
      setIntervalMinSec(preset.min);
      setIntervalMaxSec(preset.max);
    }
  }
  const [scheduleParts, setScheduleParts] = useState<DayPart[]>([]);
  const [startHour, setStartHour] = useState<string>("");
  const [endHour, setEndHour] = useState<string>("");
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePart(part: DayPart) {
    setScheduleParts((prev) => prev.includes(part) ? prev.filter((p) => p !== part) : [...prev, part]);
  }

  function toggleExclude(id: string) {
    setExcludeIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function toggleFallback(id: string) {
    setFallbackInstanceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const selectedList = lists.find((l) => l.id === listId);
  const excludedMembers = lists.filter((l) => excludeIds.includes(l.id)).reduce((sum, l) => sum + l.members, 0);
  const estimatedRecipients = Math.max(0, (selectedList?.members ?? 0) - excludedMembers);

  // Live, true completion estimate = recipients × the chosen per-message gap.
  const effMin = typeof intervalMinSec === "number" ? intervalMinSec : 0;
  const effMax = typeof intervalMaxSec === "number" ? intervalMaxSec : 0;
  const parallelFactor = sendFrom === "group" && groupSendMode === "parallel" && selectedGroup ? Math.max(1, selectedGroup.memberCount) : 1;
  const estMinLabel = formatDuration((estimatedRecipients * effMin) / parallelFactor);
  const estMaxLabel = formatDuration((estimatedRecipients * effMax) / parallelFactor);
  // Continuous send at this pace would run longer than a day — the warm-up ramp
  // will realistically spread it across several days.
  const spansDays = estimatedRecipients * effMax > 43200; // > 12h continuous

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);

    const scheduleJson = scheduleParts.length || startHour || endHour ? {
      parts: scheduleParts,
      startHour: startHour ? Number(startHour) : undefined,
      endHour: endHour ? Number(endHour) : undefined,
    } : null;

    const res = await fetch(`/api/workspaces/${workspaceSlug}/broadcasts`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name, instanceId, listId, templateId: templateId || undefined,
        mediaAssetId: mediaAssetId || undefined,
        scheduledAt: scheduleNow ? undefined : (scheduledAt ? new Date(scheduledAt).toISOString() : undefined),
        jitterMinMs, jitterMaxMs,
        intervalMinSec: intervalMinSec !== "" && intervalMinSec > 0 ? intervalMinSec : undefined,
        intervalMaxSec: intervalMaxSec !== "" && intervalMaxSec > 0 ? intervalMaxSec : undefined,
        scheduleJson,
        excludeContactListIds: excludeIds,
        fallbackInstanceIds: sendFrom === "group" ? [] : fallbackInstanceIds.filter((id) => id !== instanceId),
        instanceGroupId: sendFrom === "group" ? instanceGroupId : undefined,
        groupSendMode: sendFrom === "group" ? groupSendMode : undefined,
        rotateEvery: sendFrom === "group" && groupSendMode === "rotate" ? rotateEvery : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      return;
    }
    const { broadcast } = await res.json();
    if (scheduleNow) {
      await fetch(`/api/workspaces/${workspaceSlug}/broadcasts/${broadcast.id}/start`, { method: "POST" });
    }
    router.push(`/${workspaceSlug}/broadcasts/${broadcast.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className="w-full border rounded p-2" placeholder={t("broadcasts.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setSendFrom("single")}
          className={`flex-1 rounded border p-2 text-sm ${sendFrom === "single" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          Single number
        </button>
        <button type="button" onClick={() => setSendFrom("group")} disabled={groups.length === 0}
          className={`flex-1 rounded border p-2 text-sm disabled:opacity-40 ${sendFrom === "group" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          Group {groups.length === 0 ? "(none yet)" : ""}
        </button>
      </div>

      {sendFrom === "single" ? (
        <>
          <label className="block">
            <span className="text-sm">{t("broadcasts.pickInstance")}</span>
            <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required>
              {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>

          {/* Backup numbers */}
          <Card className="p-3 space-y-1">
            <p className="text-sm font-medium">Backup numbers (used if the first gets banned)</p>
            {instances.filter((i) => i.id !== instanceId).length === 0 ? (
              <p className="text-xs text-muted-foreground">No other numbers available to use as a backup.</p>
            ) : (
              instances.filter((i) => i.id !== instanceId).map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={fallbackInstanceIds.includes(i.id)} onChange={() => toggleFallback(i.id)} />
                  {i.label}
                </label>
              ))
            )}
          </Card>
        </>
      ) : (
        <Card className="p-3 space-y-2">
          <label className="block">
            <span className="text-sm">Group</span>
            <select className="w-full border rounded p-2 mt-1" value={instanceGroupId} onChange={(e) => setInstanceGroupId(e.target.value)}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setGroupSendMode("parallel")}
              className={`flex-1 rounded border p-2 text-sm ${groupSendMode === "parallel" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
              Parallel (all numbers at once)
            </button>
            <button type="button" onClick={() => setGroupSendMode("rotate")}
              className={`flex-1 rounded border p-2 text-sm ${groupSendMode === "rotate" ? "border-primary ring-1 ring-primary" : "border-border"}`}>
              One at a time (rotate)
            </button>
          </div>
          {groupSendMode === "rotate" && (
            <label className="block">
              <span className="text-sm">Rotate after (messages per number)</span>
              <input type="number" className="w-full border rounded p-2 mt-1" value={rotateEvery}
                onChange={(e) => setRotateEvery(Math.max(1, Number(e.target.value) || 1))} min={1} max={10000} />
            </label>
          )}
        </Card>
      )}

      <label className="block">
        <span className="text-sm">{t("broadcasts.pickList")}</span>
        <select className="w-full border rounded p-2 mt-1" value={listId} onChange={(e) => setListId(e.target.value)} required>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.members})</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">{t("broadcasts.pickTemplate")}</span>
        <select className="w-full border rounded p-2 mt-1" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">—</option>
          {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
        </select>
      </label>
      <div className="space-y-1">
        <span className="text-sm">{t("broadcasts.media")}</span>
        <MediaPicker
          workspaceSlug={workspaceSlug}
          value={mediaAssetId}
          onChange={(id) => setMediaAssetId(id)}
          label={t("broadcasts.mediaPick")}
        />
      </div>

      {/* Exclude contact groups */}
      {lists.length > 0 && (
        <Card className="p-3 space-y-1">
          <p className="text-sm font-medium">{t("broadcasts.excludeGroups")}</p>
          {lists.filter((l) => l.id !== listId).map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={excludeIds.includes(l.id)} onChange={() => toggleExclude(l.id)} />
              {l.name} ({l.members})
            </label>
          ))}
          <p className="text-xs text-muted-foreground pt-1">{t("broadcasts.estimatedRecipients")}: <strong>{estimatedRecipients}</strong></p>
        </Card>
      )}

      {/* Sending speed presets */}
      <Card className="p-3 space-y-2">
        <p className="text-sm font-medium">Sending speed</p>
        <p className="text-xs text-muted-foreground">How long to wait between each message. Slower is safer — fast sending can get your number banned.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SPEED_PRESETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickSpeed(s.id)}
              className={`text-left rounded border p-2 ${speed === s.id ? "border-primary ring-1 ring-primary bg-primary/5" : "border-border"}`}
            >
              <span className="text-sm font-medium">{s.dot} {s.label}</span>
              {s.id !== "custom" && <span className="block text-xs text-muted-foreground">{s.min}–{s.max}s gap · {s.hint}</span>}
              {s.id === "custom" && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
            </button>
          ))}
        </div>

        {speed === "custom" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("broadcasts.intervalMin")}</span>
              <input type="number" className="w-full border rounded p-2 mt-1" value={intervalMinSec} onChange={(e) => setIntervalMinSec(e.target.value === "" ? "" : Number(e.target.value))} min={0} max={3600} placeholder="0" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("broadcasts.intervalMax")}</span>
              <input type="number" className="w-full border rounded p-2 mt-1" value={intervalMaxSec} onChange={(e) => setIntervalMaxSec(e.target.value === "" ? "" : Number(e.target.value))} min={0} max={7200} placeholder="0" />
            </label>
          </div>
        )}

        {/* True estimate: recipients × gap */}
        <div className="rounded bg-muted/50 p-2 text-sm">
          {estimatedRecipients > 0 && effMax > 0 ? (
            <>
              <span className="font-medium">⏱ Est. {estMinLabel} – {estMaxLabel}</span>
              <span className="text-muted-foreground"> ({estimatedRecipients} {estimatedRecipients === 1 ? "message" : "messages"})</span>
              {spansDays && <span className="block text-xs text-muted-foreground pt-0.5">Large send — the number&apos;s warm-up limit will spread this across several days.</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Pick a list and speed to see the estimated time.</span>
          )}
        </div>
      </Card>

      {/* Schedule window */}
      <Card className="p-3 space-y-2">
        <p className="text-sm font-medium">{t("broadcasts.scheduleWindow")}</p>
        <div className="flex flex-wrap gap-2">
          {DAY_PARTS.map((dp) => (
            <button
              key={dp.value}
              type="button"
              onClick={() => togglePart(dp.value)}
              className={`px-3 py-1 rounded-full text-xs border ${scheduleParts.includes(dp.value) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
            >
              {dp.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("broadcasts.startHour")}</span>
            <input type="number" className="w-full border rounded p-1 mt-1 text-sm" value={startHour} onChange={(e) => setStartHour(e.target.value)} min={0} max={23} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("broadcasts.endHour")}</span>
            <input type="number" className="w-full border rounded p-1 mt-1 text-sm" value={endHour} onChange={(e) => setEndHour(e.target.value)} min={0} max={23} placeholder="23" />
          </label>
        </div>
      </Card>

      <label className="flex gap-2 items-center text-sm">
        <input type="checkbox" checked={scheduleNow} onChange={(e) => setScheduleNow(e.target.checked)} />
        {t("broadcasts.scheduleNow")}
      </label>
      {!scheduleNow && (
        <label className="block">
          <span className="text-sm">{t("broadcasts.scheduleLater")}</span>
          <input type="datetime-local" className="w-full border rounded p-2 mt-1" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm">{t("broadcasts.jitterMin")}</span>
          <input type="number" className="w-full border rounded p-2 mt-1" value={jitterMinMs} onChange={(e) => setJitterMinMs(Number(e.target.value))} min={0} max={60000} />
        </label>
        <label className="block">
          <span className="text-sm">{t("broadcasts.jitterMax")}</span>
          <input type="number" className="w-full border rounded p-2 mt-1" value={jitterMaxMs} onChange={(e) => setJitterMaxMs(Number(e.target.value))} min={0} max={120000} />
        </label>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={busy}>{t("broadcasts.create")}</Button>
    </form>
  );
}
