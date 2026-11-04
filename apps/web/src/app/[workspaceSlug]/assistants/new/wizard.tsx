"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VOICES, toneForVoice, type VoiceId } from "@/lib/assistant";
import { KnowledgeStep } from "./knowledge-step";
import { TryItStep } from "./try-it-step";
import { GoLiveStep } from "./go-live-step";

type KnowledgeItem = {
  id: string;
  title: string;
  sourceType: string;
  sourceLabel: string | null;
};

const STEPS = [
  { num: 1, label: "Personality" },
  { num: 2, label: "Knowledge" },
  { num: 3, label: "Try it" },
  { num: 4, label: "Go live" },
] as const;

const textareaCls =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export default function Wizard({
  workspaceSlug,
  instances,
}: {
  workspaceSlug: string;
  instances: { id: string; label: string }[];
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [voice, setVoice] = useState<VoiceId>("friendly");
  const [firstMessage, setFirstMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 — Knowledge state
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [onlyFromKnowledge, setOnlyFromKnowledge] = useState(true);
  const [handoff, setHandoff] = useState(true);
  const [handoffMessage, setHandoffMessage] = useState("Let me get a colleague to help you 🙏");

  function back() {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  }

  async function createAndNext() {
    setError(null);
    setBusy(true);

    if (!topicId) {
      // First time through step 1 — create the topic
      const res = await fetch(`/api/workspaces/${workspaceSlug}/topics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setBusy(false);
        setError("Could not create — is the name already used?");
        return;
      }
      const { topic } = await res.json();
      await fetch(`/api/workspaces/${workspaceSlug}/topics/${topic.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personaTone: toneForVoice(voice), greeting: firstMessage || null }),
      });
      setTopicId(topic.id);
    } else {
      // Returning to step 1 and clicking Next again — update the existing topic
      await fetch(`/api/workspaces/${workspaceSlug}/topics/${topicId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, personaTone: toneForVoice(voice), greeting: firstMessage || null }),
      });
    }

    setBusy(false);
    setStep(2);
  }

  return (
    <div className="mx-auto max-w-xl py-10 px-4 space-y-8">
      {/* Progress rail */}
      <nav aria-label="Setup progress">
        <ol className="flex items-center gap-0">
          {STEPS.map((s, i) => {
            const active = s.num === step;
            const done = s.num < step;
            return (
              <li key={s.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                        ? "bg-primary/20 text-primary"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {s.num}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-medium whitespace-nowrap",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-px flex-1 mb-5 transition-colors",
                      done ? "bg-primary/30" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step bodies */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        {/* Step 1 — Personality */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Name your assistant</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Give it a name your customers will recognise.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assistant-name">Name</Label>
              <Input
                id="assistant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="e.g. Support Bot"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>How should it sound?</Label>
              <div className="flex flex-wrap gap-2">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoice(v.id)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition-colors border",
                      voice === v.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary text-muted-foreground border-border hover:text-foreground",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="first-message">
                First message{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <textarea
                id="first-message"
                className={textareaCls}
                rows={3}
                value={firstMessage}
                onChange={(e) => setFirstMessage(e.target.value)}
                placeholder="Hi! How can I help you today?"
              />
              <p className="text-xs text-muted-foreground">
                The opening message the assistant sends when a conversation starts.
              </p>
            </div>
          </div>
        )}

        {/* Step 2 — Knowledge */}
        {step === 2 && topicId && (
          <KnowledgeStep
            workspaceSlug={workspaceSlug}
            topicId={topicId}
            knowledgeItems={knowledgeItems}
            totalTokens={totalTokens}
            onlyFromKnowledge={onlyFromKnowledge}
            handoff={handoff}
            handoffMessage={handoffMessage}
            onKnowledgeLoaded={(items, tokens) => {
              setKnowledgeItems(items);
              setTotalTokens(tokens);
            }}
            onOnlyFromKnowledgeChange={setOnlyFromKnowledge}
            onHandoffChange={setHandoff}
            onHandoffMessageChange={setHandoffMessage}
          />
        )}

        {/* Step 3 — Try it */}
        {step === 3 && topicId && (
          <TryItStep
            workspaceSlug={workspaceSlug}
            topicId={topicId}
            guardrails={{ onlyFromKnowledge, handoff, handoffMessage }}
            onBack={back}
            onNext={() => setStep(4)}
          />
        )}

        {/* Step 4 — Go live */}
        {step === 4 && topicId && (
          <GoLiveStep
            workspaceSlug={workspaceSlug}
            topicId={topicId}
            instances={instances}
            persona={{ voice, firstMessage }}
            guardrails={{ onlyFromKnowledge, handoff, handoffMessage }}
            onBack={back}
          />
        )}

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Navigation — steps 3 and 4 own their own Back/Next inside their components */}
        {step !== 3 && step !== 4 && (
        <div className="flex items-center justify-between pt-2">
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={back} disabled={busy}>
              Back
            </Button>
          ) : (
            <span />
          )}

          {step === 1 && (
            <Button
              type="button"
              disabled={!name.trim() || busy}
              onClick={createAndNext}
            >
              {busy ? "Saving…" : "Next"}
            </Button>
          )}

          {step === 2 && (
            <div className="flex flex-col items-end gap-1">
              {knowledgeItems.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No knowledge added yet — you can still continue and add it later.
                </p>
              )}
              <Button type="button" onClick={() => setStep(3)} disabled={busy}>
                Next
              </Button>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
