"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import AiForm from "./ai-form";

type Cfg = { provider: string; defaultModel: string; endpoint?: string | null } | null;

const TABS: { key: string; label: string; blurb: string }[] = [
  { key: "default", label: "Default", blurb: "Used by any AI feature that doesn't have its own setting below." },
  { key: "warmer", label: "Warmer", blurb: "For number-warming small-talk. A cheap/free model (e.g. Ollama) is ideal — quality barely matters." },
  { key: "chatbot", label: "Chatbot", blurb: "For customer replies. Use a higher-quality model (e.g. Gemini / Claude)." },
];

/** Per-feature AI configuration — a separate provider/key/model per scope. */
export default function AiScopes({ workspaceSlug, initials }: { workspaceSlug: string; initials: Record<string, Cfg> }) {
  const [active, setActive] = useState("default");
  const tab = TABS.find((t) => t.key === active)!;
  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {initials[t.key] && <span className="ml-1.5 text-xs text-primary">●</span>}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{tab.blurb}</p>
      <AiForm key={active} workspaceSlug={workspaceSlug} scope={active} initial={initials[active] ?? null} />
    </div>
  );
}
