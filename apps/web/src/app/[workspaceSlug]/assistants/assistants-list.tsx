"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AssistantSummary } from "@/lib/assistant-data";
import { StatusPill } from "@/components/ui/status-pill";
import { Bot } from "lucide-react";

export default function AssistantsList({
  workspaceSlug,
  initial,
}: {
  workspaceSlug: string;
  initial: AssistantSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    setShowBanner(localStorage.getItem("assistants-migration-dismissed") !== "1");
  }, []);

  function dismiss() {
    localStorage.setItem("assistants-migration-dismissed", "1");
    setShowBanner(false);
  }

  async function turnOff(id: string) {
    setBusy(id);
    await fetch(`/api/workspaces/${workspaceSlug}/assistants/${id}/activate`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Assistants</h1>
          <p className="text-sm text-muted-foreground">
            Give an assistant a brain and a phone number. It answers your WhatsApp automatically.
          </p>
        </div>
        <Link
          href={`/${workspaceSlug}/assistants/new`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          + New Assistant
        </Link>
      </div>

      {showBanner && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground">
          <span>
            We turned your existing setup into Assistants — nothing lost. Live ones stay live; drafts are off until you
            switch them on.
          </span>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      {initial.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No assistants yet. Create one to auto-reply on WhatsApp.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold">{a.name}</div>
                <StatusPill tone={a.status === "live" ? "success" : "neutral"}>
                  {a.status === "live" ? `Live on ${a.liveOn}` : "Draft — not on a number yet"}
                </StatusPill>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {a.knowledgeCount} knowledge items · {a.voice}
            </p>
            <div className="mt-3 flex gap-2">
              <Link
                href={`/${workspaceSlug}/assistants/${a.id}`}
                className="flex-1 rounded-md border border-border py-2 text-center text-xs font-semibold"
              >
                Edit
              </Link>
              {a.status === "live" ? (
                <button
                  disabled={busy === a.id}
                  onClick={() => turnOff(a.id)}
                  className="flex-1 rounded-md border border-border py-2 text-center text-xs font-semibold"
                >
                  Turn off
                </button>
              ) : (
                <Link
                  href={`/${workspaceSlug}/assistants/${a.id}`}
                  className="flex-1 rounded-md border border-border py-2 text-center text-xs font-semibold"
                >
                  Turn on…
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
