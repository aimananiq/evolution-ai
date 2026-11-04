"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { toneForVoice, buildGuardrails, type VoiceId } from "@/lib/assistant";

type Guardrails = {
  onlyFromKnowledge: boolean;
  handoff: boolean;
  handoffMessage: string;
};

type Persona = {
  voice: VoiceId;
  firstMessage: string;
};

export function GoLiveStep({
  workspaceSlug,
  topicId,
  instances,
  persona,
  guardrails,
  onBack,
}: {
  workspaceSlug: string;
  topicId: string;
  instances: { id: string; label: string }[];
  persona: Persona;
  guardrails: Guardrails;
  onBack: () => void;
}) {
  const router = useRouter();
  const [instanceId, setInstanceId] = useState<string>(instances[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persistPersonaAndGuardrails() {
    const res = await fetch(`/api/workspaces/${workspaceSlug}/topics/${topicId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        personaTone: toneForVoice(persona.voice),
        greeting: persona.firstMessage || null,
        guardrails: buildGuardrails(guardrails),
      }),
    });
    return res;
  }

  async function handleTurnOn() {
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      const putRes = await persistPersonaAndGuardrails();
      if (!putRes.ok) {
        setError("Could not save settings. Please try again.");
        setBusy(false);
        return;
      }

      const activateRes = await fetch(
        `/api/workspaces/${workspaceSlug}/assistants/${topicId}/activate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instanceId }),
        },
      );

      if (!activateRes.ok) {
        const data = await activateRes.json().catch(() => ({}));
        setError(data?.error ?? "Could not activate the assistant. Please try again.");
        setBusy(false);
        return;
      }

      router.push(`/${workspaceSlug}/assistants/${topicId}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  async function handleSaveAsDraft() {
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      const putRes = await persistPersonaAndGuardrails();
      if (!putRes.ok) {
        setError("Could not save draft. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/${workspaceSlug}/assistants/${topicId}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Turn it on for a WhatsApp number
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which connected number this assistant will reply on.
        </p>
      </div>

      {instances.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary/30 px-4 py-5 space-y-3">
          <p className="text-sm text-foreground font-medium">No WhatsApp number connected yet</p>
          <p className="text-sm text-muted-foreground">
            Connect a WhatsApp number first, then come back to turn on this assistant.
          </p>
          <Link
            href={`/${workspaceSlug}/instances`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Connect a WhatsApp number
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="instance-select"
              className="text-sm font-medium text-foreground"
            >
              WhatsApp number
            </label>
            <select
              id="instance-select"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              disabled={busy}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy || !instanceId}
            onClick={handleTurnOn}
          >
            {busy ? "Turning on…" : "Turn on — start replying now"}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSaveAsDraft}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save as draft
        </button>
      </div>
    </div>
  );
}
