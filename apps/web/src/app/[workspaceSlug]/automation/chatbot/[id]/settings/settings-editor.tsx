"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Initial = {
  pauseBot: boolean;
  unsubscribeKeyword: string;
  scheduleJson: string;
  limiterJson: string;
  filterJson: string;
  fallbackProvider: "none" | "claude" | "openai";
  fallbackModel: string;
  aiTemperature: number | null;
  aiContextLength: number | null;
};

function tryParseJson(s: string): unknown {
  if (!s.trim()) return null;
  try { return JSON.parse(s); } catch { return undefined; }
}

export default function SettingsEditor({
  workspaceSlug,
  chatbotId,
  initial,
}: {
  workspaceSlug: string;
  chatbotId: string;
  initial: Initial;
}) {
  const t = useTranslations();

  const [pauseBot, setPauseBot] = useState(initial.pauseBot);
  const [unsubscribeKeyword, setUnsubscribeKeyword] = useState(initial.unsubscribeKeyword);
  const [scheduleJsonRaw, setScheduleJsonRaw] = useState(initial.scheduleJson);
  const [limiterJsonRaw, setLimiterJsonRaw] = useState(initial.limiterJson);
  const [filterJsonRaw, setFilterJsonRaw] = useState(initial.filterJson);
  const [provider, setProvider] = useState<string>(initial.fallbackProvider);
  const [model, setModel] = useState(initial.fallbackModel);
  const [aiTemperature, setAiTemperature] = useState<string>(
    initial.aiTemperature !== null ? String(initial.aiTemperature) : ""
  );
  const [aiContextLength, setAiContextLength] = useState<string>(
    initial.aiContextLength !== null ? String(initial.aiContextLength) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const scheduleJson = tryParseJson(scheduleJsonRaw);
    const limiterJson = tryParseJson(limiterJsonRaw);
    const filterJson = tryParseJson(filterJsonRaw);

    if (scheduleJson === undefined) { setError("scheduleJson is invalid JSON"); setBusy(false); return; }
    if (limiterJson === undefined) { setError("limiterJson is invalid JSON"); setBusy(false); return; }
    if (filterJson === undefined) { setError("filterJson is invalid JSON"); setBusy(false); return; }

    const body: Record<string, unknown> = {
      pauseBot,
      unsubscribeKeyword: unsubscribeKeyword || null,
      scheduleJson,
      limiterJson,
      filterJson,
      fallbackProvider: provider,
      fallbackModel: provider === "none" ? null : model || null,
    };
    if (aiTemperature !== "") body.aiTemperature = parseFloat(aiTemperature);
    if (aiContextLength !== "") body.aiContextLength = parseInt(aiContextLength, 10);

    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to save");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* General Settings */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("aiActions.general")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pauseBot}
            onChange={(e) => setPauseBot(e.target.checked)}
          />
          {t("aiActions.pauseBot")}
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.unsubscribeKeyword")}</span>
          <input
            className="w-full border rounded p-2 mt-1 text-sm"
            value={unsubscribeKeyword}
            onChange={(e) => setUnsubscribeKeyword(e.target.value)}
            maxLength={80}
          />
        </label>
        <label className="block">
          <span className="text-sm">Schedule JSON (optional)</span>
          <textarea
            className="w-full border rounded p-2 mt-1 text-sm font-mono"
            rows={3}
            value={scheduleJsonRaw}
            onChange={(e) => setScheduleJsonRaw(e.target.value)}
            placeholder='{"timezone":"Asia/Kuala_Lumpur","hours":[[9,18]]}'
          />
        </label>
        <label className="block">
          <span className="text-sm">Rate limiter JSON (optional)</span>
          <textarea
            className="w-full border rounded p-2 mt-1 text-sm font-mono"
            rows={2}
            value={limiterJsonRaw}
            onChange={(e) => setLimiterJsonRaw(e.target.value)}
            placeholder='{"maxPerHour":20}'
          />
        </label>
        <label className="block">
          <span className="text-sm">Filter JSON (optional)</span>
          <textarea
            className="w-full border rounded p-2 mt-1 text-sm font-mono"
            rows={2}
            value={filterJsonRaw}
            onChange={(e) => setFilterJsonRaw(e.target.value)}
            placeholder='{"allowGroups":false}'
          />
        </label>
      </section>

      {/* AI Settings */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("aiActions.aiSettings")}</h2>
        <label className="block">
          <span className="text-sm">AI fallback</span>
          <select
            className="w-full border rounded p-2 mt-1 text-sm"
            value={provider === "none" ? "none" : "on"}
            onChange={(e) => setProvider(e.target.value === "none" ? "none" : "claude")}
          >
            <option value="none">Off — keyword rules only</option>
            <option value="on">On — answer with AI when no rule matches</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Uses this workspace&apos;s AI provider (set it in{" "}
            <Link href={`/${workspaceSlug}/settings/integrations/ai`} className="underline">Settings → Integrations → AI</Link>
            {" "}— Gemini, Ollama, Grok, Claude…), grounded in your Knowledge base.
          </span>
        </label>
        {provider !== "none" && (
          <label className="block">
            <span className="text-sm">Model override (optional)</span>
            <input
              className="w-full border rounded p-2 mt-1 text-sm"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={80}
              placeholder="leave blank to use the workspace default model"
            />
          </label>
        )}
        <label className="block">
          <span className="text-sm">{t("aiActions.aiTemperature")} (0–2)</span>
          <input
            type="number"
            className="w-full border rounded p-2 mt-1 text-sm"
            value={aiTemperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(e) => setAiTemperature(e.target.value)}
            placeholder="0.7"
          />
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.aiContextLength")} (messages, 1–64)</span>
          <input
            type="number"
            className="w-full border rounded p-2 mt-1 text-sm"
            value={aiContextLength}
            min={1}
            max={64}
            onChange={(e) => setAiContextLength(e.target.value)}
            placeholder="10"
          />
        </label>
      </section>

      {/* Advanced AI Settings (placeholder) */}
      <section className="border rounded p-4 space-y-2">
        <h2 className="font-semibold">{t("aiActions.advanced")}</h2>
        <details>
          <summary className="text-sm text-muted-foreground cursor-pointer">AI Sensory Pack — <em>coming soon</em></summary>
          <p className="text-xs text-muted-foreground mt-1">Voice, image and document understanding — planned for a future release.</p>
        </details>
        <details>
          <summary className="text-sm text-muted-foreground cursor-pointer">Structured Reply — <em>coming soon</em></summary>
          <p className="text-xs text-muted-foreground mt-1">Force the model to reply in a fixed JSON schema — planned for a future release.</p>
        </details>
      </section>

      {/* Save */}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {saved && <p className="text-green-600 text-sm">Saved.</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {t("aiActions.save")}
      </button>
    </div>
  );
}
