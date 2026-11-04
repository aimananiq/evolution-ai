"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { MediaPicker } from "@/components/media-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DayPart = "daytime" | "nighttime" | "odd" | "even";

interface ScheduleConfig {
  parts: DayPart[];
  startHour?: number;
  endHour?: number;
}

interface Initial {
  instanceId: string;
  enabled: boolean;
  sendTo: "all" | "individual" | "group";
  text: string | null;
  caption: string | null;
  mediaAssetId: string | null;
  rejectCall: boolean;
  msgCall: string | null;
  pausePerCustomerSec: number;
  scheduleJson: ScheduleConfig | null;
  excludeContactListIds: string[];
}

interface Opt { id: string; label: string }

const PAUSE_OPTIONS = [
  { value: 0, label: "No pause" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "24 hours" },
];

const DAY_PARTS: { value: DayPart; label: string }[] = [
  { value: "daytime", label: "Daytime (06:00–18:00)" },
  { value: "nighttime", label: "Nighttime (18:00–06:00)" },
  { value: "odd", label: "Odd days" },
  { value: "even", label: "Even days" },
];

export default function AutoresponderEditor({
  workspaceSlug,
  instances,
  lists,
  initial,
}: {
  workspaceSlug: string;
  instances: Opt[];
  lists: { id: string; name: string }[];
  initial: Initial | null;
}) {
  const t = useTranslations();
  const router = useRouter();

  const defaultInstance = instances[0];
  const [instanceId, setInstanceId] = useState(initial?.instanceId ?? defaultInstance?.id ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [sendTo, setSendTo] = useState<"all" | "individual" | "group">(initial?.sendTo ?? "all");
  const [text, setText] = useState(initial?.text ?? "");
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [mediaAssetId, setMediaAssetId] = useState<string | null>(initial?.mediaAssetId ?? null);
  const [rejectCall, setRejectCall] = useState(initial?.rejectCall ?? false);
  const [msgCall, setMsgCall] = useState(initial?.msgCall ?? "");
  const [pauseSec, setPauseSec] = useState(initial?.pausePerCustomerSec ?? 60);
  const [scheduleParts, setScheduleParts] = useState<DayPart[]>(initial?.scheduleJson?.parts ?? []);
  const [startHour, setStartHour] = useState<string>(initial?.scheduleJson?.startHour?.toString() ?? "");
  const [endHour, setEndHour] = useState<string>(initial?.scheduleJson?.endHour?.toString() ?? "");
  const [excludeIds, setExcludeIds] = useState<string[]>(initial?.excludeContactListIds ?? []);

  // Test panel state
  const [testTo, setTestTo] = useState("");
  const [testText, setTestText] = useState(initial?.text ?? "");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function togglePart(part: DayPart) {
    setScheduleParts((prev) =>
      prev.includes(part) ? prev.filter((p) => p !== part) : [...prev, part]
    );
  }

  function toggleExclude(id: string) {
    setExcludeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function save() {
    if (!instanceId) return;
    setBusy(true);
    setError(null);
    setSaved(false);

    const scheduleJson: ScheduleConfig | null =
      scheduleParts.length > 0 || startHour || endHour
        ? {
            parts: scheduleParts,
            ...(startHour ? { startHour: parseInt(startHour, 10) } : {}),
            ...(endHour ? { endHour: parseInt(endHour, 10) } : {}),
          }
        : null;

    const res = await fetch(`/api/workspaces/${workspaceSlug}/autoresponder`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId,
        enabled,
        sendTo,
        text: text.trim() || null,
        mediaAssetId,
        caption: caption.trim() || null,
        rejectCall,
        msgCall: msgCall.trim() || null,
        pausePerCustomerSec: pauseSec,
        scheduleJson,
        excludeContactListIds: excludeIds,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    }
  }

  async function sendTest() {
    if (!instanceId || !testTo.trim() || !testText.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/autoresponder/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, to: testTo.trim(), text: testText.trim() }),
    });
    setTestBusy(false);
    if (res.ok) {
      const body = await res.json();
      setTestResult(`Sent! Message ID: ${body.messageId ?? "unknown"}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setTestResult(`Error: ${body.error ?? "SEND_FAILED"}`);
    }
  }

  return (
    <div className="space-y-6">
      {/* Instance selector */}
      {instances.length > 1 && (
        <label className="block">
          <span className="text-sm font-medium">{t("autoresponder.instance")}</span>
          <select
            className="mt-1 w-full rounded border p-2 text-sm"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
          >
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </label>
      )}

      {/* Status */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.status")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("autoresponder.enabled")}
          </label>
        </CardContent>
      </Card>

      {/* Send To */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.sendTo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {(["all", "individual", "group"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" name="sendTo" value={v} checked={sendTo === v} onChange={() => setSendTo(v)} />
              {t(`autoresponder.sendTo_${v}`)}
            </label>
          ))}
        </CardContent>
      </Card>

      {/* Message text */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.message")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <label className="block">
            <span className="text-sm">{t("autoresponder.text")}</span>
            <WhatsAppRichEditor
              value={text}
              onChange={(v) => setText(v)}
              placeholder={t("autoresponder.textPlaceholder")}
              minRows={4}
            />
          </label>
          <label className="block">
            <span className="text-sm">{t("autoresponder.caption")}</span>
            <input
              className="mt-1 w-full rounded border p-2 text-sm"
              maxLength={1000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <div className="space-y-1">
            <span className="text-sm">{t("autoresponder.media")}</span>
            <MediaPicker
              workspaceSlug={workspaceSlug}
              value={mediaAssetId}
              onChange={(assetId) => setMediaAssetId(assetId)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Send Test */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.sendTest")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <label className="block">
            <span className="text-sm">{t("autoresponder.testTo")}</span>
            <input
              className="mt-1 w-full rounded border p-2 text-sm"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="60123456789"
            />
          </label>
          <label className="block">
            <span className="text-sm">{t("autoresponder.testText")}</span>
            <input
              className="mt-1 w-full rounded border p-2 text-sm"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={testBusy || !testTo.trim() || !testText.trim()}
            onClick={sendTest}
          >
            {testBusy ? t("common.loading") : t("autoresponder.sendTestBtn")}
          </Button>
          {testResult && (
            <p className={`text-sm ${testResult.startsWith("Error") ? "text-destructive" : "text-green-700"}`}>
              {testResult}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reject call */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.rejectCall")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={rejectCall} onChange={(e) => setRejectCall(e.target.checked)} />
            {t("autoresponder.rejectCallEnable")}
          </label>
          {rejectCall && (
            <label className="block">
              <span className="text-sm">{t("autoresponder.msgCall")}</span>
              <input
                className="mt-1 w-full rounded border p-2 text-sm"
                maxLength={1000}
                value={msgCall}
                onChange={(e) => setMsgCall(e.target.value)}
                placeholder={t("autoresponder.msgCallPlaceholder")}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {/* Pause per customer */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.pause")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <label className="block">
            <span className="text-sm">{t("autoresponder.pauseLabel")}</span>
            <select
              className="mt-1 w-full rounded border p-2 text-sm"
              value={pauseSec}
              onChange={(e) => setPauseSec(Number(e.target.value))}
            >
              {PAUSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">{t("autoresponder.schedule")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-xs text-muted-foreground">{t("autoresponder.scheduleHint")}</p>
          <div className="flex flex-wrap gap-2">
            {DAY_PARTS.map((dp) => (
              <button
                key={dp.value}
                type="button"
                onClick={() => togglePart(dp.value)}
                className={`rounded px-3 py-1 text-xs border ${
                  scheduleParts.includes(dp.value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:bg-accent"
                }`}
              >
                {dp.label}
              </button>
            ))}
          </div>
          <div className="flex gap-4">
            <label className="block">
              <span className="text-sm">{t("autoresponder.startHour")}</span>
              <input
                type="number"
                min={0}
                max={23}
                className="mt-1 w-20 rounded border p-2 text-sm"
                value={startHour}
                onChange={(e) => setStartHour(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className="text-sm">{t("autoresponder.endHour")}</span>
              <input
                type="number"
                min={0}
                max={23}
                className="mt-1 w-20 rounded border p-2 text-sm"
                value={endHour}
                onChange={(e) => setEndHour(e.target.value)}
                placeholder="23"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Exclude contact groups */}
      {lists.length > 0 && (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">{t("autoresponder.excludeLists")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground">{t("autoresponder.excludeListsHint")}</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {lists.map((list) => (
                <label key={list.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={excludeIds.includes(list.id)}
                    onChange={() => toggleExclude(list.id)}
                  />
                  {list.name}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={busy || !instanceId}
          onClick={save}
        >
          {busy ? t("common.loading") : t("common.save")}
        </Button>
        {saved && <span className="text-sm text-green-700">{t("common.saved")}</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}
