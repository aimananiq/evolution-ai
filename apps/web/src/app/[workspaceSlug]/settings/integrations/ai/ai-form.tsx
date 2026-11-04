"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Initial = { provider: string; defaultModel: string; endpoint?: string | null } | null;

const PROVIDERS: { value: string; label: string }[] = [
  { value: "gemini", label: "Google Gemini (free tier / student)" },
  { value: "ollama", label: "Ollama (local or cloud)" },
  { value: "grok", label: "Grok (xAI)" },
  { value: "claude", label: "Anthropic Claude" },
  { value: "openai", label: "OpenAI" },
];
const DEFAULT_MODEL: Record<string, string> = {
  claude: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.5-flash",
  grok: "grok-3-mini",
  openai: "gpt-4o-mini",
  ollama: "gpt-oss:20b",
};
const KEY_PLACEHOLDER: Record<string, string> = {
  claude: "sk-ant-…",
  gemini: "Google AI Studio key (AIza…)",
  grok: "xAI key (xai-…)",
  openai: "sk-…",
  ollama: "Ollama Cloud key (leave blank for local Ollama)",
};
const KEY_HELP: Record<string, string> = {
  gemini: "Free key from aistudio.google.com → Get API key.",
  grok: "Key from console.x.ai.",
  ollama: "Cloud key from ollama.com; leave blank for a self-hosted Ollama.",
};
const CUSTOM = "__custom__";

export default function AiForm({ workspaceSlug, initial, scope = "default" }: { workspaceSlug: string; initial: Initial; scope?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [provider, setProvider] = useState(initial?.provider ?? "gemini");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [defaultModel, setDefaultModel] = useState<string>(initial?.defaultModel ?? DEFAULT_MODEL.gemini ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLive, setModelsLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOllama = provider === "ollama";
  const needsKey = provider !== "ollama";

  // Load the selectable model list for the current provider (Ollama = live).
  useEffect(() => {
    let alive = true;
    fetch(`/api/workspaces/${workspaceSlug}/ai-models?provider=${provider}&scope=${scope}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setModels(d.models ?? []); setModelsLive(!!d.live); } })
      .catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider, workspaceSlug, scope]);

  function onProviderChange(p: string) {
    setProvider(p);
    if (!defaultModel || Object.values(DEFAULT_MODEL).includes(defaultModel)) setDefaultModel(DEFAULT_MODEL[p] ?? "");
    if (p === "ollama" && !endpoint) setEndpoint("https://ollama.com");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/ai-keys`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, provider, apiKey, endpoint: isOllama ? endpoint : undefined, defaultModel }),
    });
    setBusy(false);
    if (res.ok) { setFeedback(t("aiKeys.stored")); setApiKey(""); router.refresh(); }
    else setError(t("aiKeys.saveError"));
  }

  async function remove() {
    if (!confirm(t("aiKeys.confirmRemove"))) return;
    await fetch(`/api/workspaces/${workspaceSlug}/ai-keys?scope=${scope}`, { method: "DELETE" });
    setFeedback(null);
    router.refresh();
  }

  const canSave = !needsKey || !!apiKey || !!initial;
  const isKnownModel = models.includes(defaultModel);

  return (
    <form onSubmit={save} className="space-y-3 border rounded-xl p-4">
      {initial ? (
        <p className="text-xs text-green-700">{t("aiKeys.stored")}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("aiKeys.noKey")}</p>
      )}

      <label className="block">
        <span className="text-sm">{t("aiKeys.providerLabel")}</span>
        <select className="w-full border rounded p-2 mt-1" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>

      {isOllama && (
        <label className="block">
          <span className="text-sm">{t("aiKeys.endpointLabel")}</span>
          <input className="w-full border rounded p-2 mt-1" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://ollama.com  (or http://localhost:11434)" />
          <span className="text-xs text-muted-foreground">{t("aiKeys.endpointHelp")}</span>
        </label>
      )}

      <label className="block">
        <span className="text-sm">{t("aiKeys.keyLabel")}</span>
        <input type="password" className="w-full border rounded p-2 mt-1" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={KEY_PLACEHOLDER[provider] ?? ""} />
        {KEY_HELP[provider] && <span className="mt-1 block text-xs text-muted-foreground">{KEY_HELP[provider]}</span>}
        {initial && <span className="text-xs text-muted-foreground">{t("aiKeys.keyKeepHint")}</span>}
      </label>

      <label className="block">
        <span className="text-sm">{t("aiKeys.modelLabel")}</span>
        <select
          className="w-full border rounded p-2 mt-1"
          value={isKnownModel ? defaultModel : CUSTOM}
          onChange={(e) => setDefaultModel(e.target.value === CUSTOM ? "" : e.target.value)}
        >
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value={CUSTOM}>Custom / other model…</option>
        </select>
        {!isKnownModel && (
          <input className="w-full border rounded p-2 mt-2" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="type an exact model id" />
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {isOllama
            ? modelsLive
              ? "Live from your Ollama — pick any listed, or Custom for a self-hosted model."
              : "Save an Ollama key to load the live model list; meanwhile pick a recommended one or Custom."
            : "Pick a model or choose Custom to type any the provider supports."}
        </span>
      </label>

      <div className="flex gap-2">
        <Button disabled={busy || !canSave}>{t("aiKeys.save")}</Button>
        {initial && (
          <Button type="button" variant="outline" onClick={remove} className="text-destructive hover:text-destructive">
            {t("aiKeys.remove")}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {feedback && <p className="text-sm text-green-700">{feedback}</p>}
    </form>
  );
}
