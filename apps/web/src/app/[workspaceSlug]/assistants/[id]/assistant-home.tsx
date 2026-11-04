"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import {
  VOICES,
  voiceForTone,
  toneForVoice,
  sizeLabel,
  type VoiceId,
} from "@/lib/assistant";
import { KnowledgeStep } from "../new/knowledge-step";
import { TryItStep } from "../new/try-it-step";
import { AdvancedSection } from "./advanced-section";

type KnowledgeItem = {
  id: string;
  title: string;
  sourceType: string;
  sourceLabel: string | null;
};

type Guardrails = {
  stayOnTopic?: boolean;
  answerOnlyFromKnowledge?: boolean;
  handoff?: { enabled?: boolean; triggers?: string[]; onUnsure?: boolean };
  neverSay?: string[];
  fallbackMessage?: string;
};

type Topic = {
  id: string;
  name: string;
  personaTone: string | null;
  greeting: string | null;
  guardrails: unknown;
};

const textareaCls =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const selectCls =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function AssistantHome({
  workspaceSlug,
  topic,
  knowledgeCount,
  live,
  liveOn,
  liveChatbotId,
  liveInstanceId,
  instances,
}: {
  workspaceSlug: string;
  topic: Topic;
  knowledgeCount: number;
  live: boolean;
  liveOn: string | null;
  liveChatbotId: string | null;
  liveInstanceId: string | null;
  instances: { id: string; label: string }[];
}) {
  const router = useRouter();
  const g = (topic.guardrails ?? {}) as Guardrails;

  const derivedGuardrails = {
    onlyFromKnowledge: g.answerOnlyFromKnowledge ?? true,
    handoff: g.handoff?.enabled ?? true,
    handoffMessage: g.fallbackMessage ?? "",
  };

  // --- Personality state ---
  const [name, setName] = useState(topic.name);
  const [voice, setVoice] = useState<VoiceId>(voiceForTone(topic.personaTone));
  const [firstMessage, setFirstMessage] = useState(topic.greeting ?? "");
  const [savingPersona, setSavingPersona] = useState(false);

  async function savePersona() {
    setSavingPersona(true);
    await fetch(`/api/workspaces/${workspaceSlug}/topics/${topic.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        personaTone: toneForVoice(voice),
        greeting: firstMessage || null,
      }),
    });
    setSavingPersona(false);
    router.refresh();
  }

  // --- On/Off state ---
  const [showTurnOn, setShowTurnOn] = useState(false);
  const [turnOnInstance, setTurnOnInstance] = useState(instances[0]?.id ?? "");
  const [toggling, setToggling] = useState(false);

  async function turnOn(instanceId: string) {
    if (!instanceId || toggling) return;
    setToggling(true);
    await fetch(`/api/workspaces/${workspaceSlug}/assistants/${topic.id}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId }),
    });
    setToggling(false);
    setShowTurnOn(false);
    router.refresh();
  }

  async function turnOff() {
    if (toggling) return;
    setToggling(true);
    await fetch(`/api/workspaces/${workspaceSlug}/assistants/${topic.id}/activate`, {
      method: "DELETE",
    });
    setToggling(false);
    router.refresh();
  }

  // --- Knowledge state (embedded KnowledgeStep) ---
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [onlyFromKnowledge, setOnlyFromKnowledge] = useState(derivedGuardrails.onlyFromKnowledge);
  const [handoff, setHandoff] = useState(derivedGuardrails.handoff);
  const [handoffMessage, setHandoffMessage] = useState(derivedGuardrails.handoffMessage);

  const knSize = sizeLabel(totalTokens);

  // Other connected instances not already live on this assistant.
  // Filter by id (labels are not unique within a workspace).
  const otherInstances = instances.filter((i) => i.id !== liveInstanceId);

  const [useOtherInstance, setUseOtherInstance] = useState("");

  return (
    <div className="mx-auto max-w-2xl py-10 px-4 space-y-8">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold text-primary">
          {topic.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{topic.name}</h1>
            {live ? (
              <StatusPill tone="success">Live on {liveOn ?? "WhatsApp"}</StatusPill>
            ) : (
              <StatusPill tone="neutral">Draft</StatusPill>
            )}
          </div>

          {live ? (
            <Button type="button" variant="outline" onClick={turnOff} disabled={toggling}>
              {toggling ? "Turning off…" : "Turn off"}
            </Button>
          ) : instances.length === 0 ? (
            <Link
              href={`/${workspaceSlug}/instances`}
              className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Connect a WhatsApp number to turn on →
            </Link>
          ) : !showTurnOn ? (
            <Button type="button" onClick={() => setShowTurnOn(true)} disabled={toggling}>
              Turn on
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Choose WhatsApp number to turn on"
                value={turnOnInstance}
                onChange={(e) => setTurnOnInstance(e.target.value)}
                disabled={toggling}
                className={cn(selectCls, "w-auto")}
              >
                {instances.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.label}
                  </option>
                ))}
              </select>
              <Button type="button" onClick={() => turnOn(turnOnInstance)} disabled={toggling || !turnOnInstance}>
                {toggling ? "Turning on…" : "Confirm"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowTurnOn(false)} disabled={toggling}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Personality */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-5">
        <h2 className="text-lg font-semibold text-foreground">Personality</h2>

        <div className="space-y-1.5">
          <Label htmlFor="ah-name">Name</Label>
          <Input
            id="ah-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
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
          <Label htmlFor="ah-first-message">
            First message{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <textarea
            id="ah-first-message"
            className={textareaCls}
            rows={3}
            value={firstMessage}
            onChange={(e) => setFirstMessage(e.target.value)}
            placeholder="Hi! How can I help you today?"
          />
        </div>

        <Button type="button" onClick={savePersona} disabled={savingPersona || !name.trim()}>
          {savingPersona ? "Saving…" : "Save"}
        </Button>
      </section>

      {/* Knowledge */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Knowledge</h2>
          <span className="text-sm text-muted-foreground">
            {knowledgeCount} item{knowledgeCount === 1 ? "" : "s"}
            {totalTokens > 0 && (
              <>
                {" · "}
                <span className="text-foreground">{knSize.label}</span>
              </>
            )}
          </span>
        </div>
        <KnowledgeStep
          workspaceSlug={workspaceSlug}
          topicId={topic.id}
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
      </section>

      {/* Try it */}
      <section className="rounded-lg border border-border bg-card p-6">
        <TryItStep
          workspaceSlug={workspaceSlug}
          topicId={topic.id}
          guardrails={{ onlyFromKnowledge, handoff, handoffMessage }}
        />
      </section>

      {/* Advanced */}
      <AdvancedSection
        workspaceSlug={workspaceSlug}
        topicId={topic.id}
        live={live}
        liveChatbotId={liveChatbotId}
        initialOnlyFromKnowledge={derivedGuardrails.onlyFromKnowledge}
        initialHandoff={derivedGuardrails.handoff}
        initialHandoffMessage={derivedGuardrails.handoffMessage}
      />

      {/* Use on another number */}
      {live && otherInstances.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">Use on another number →</span>
          <select
            aria-label="Choose another WhatsApp number"
            value={useOtherInstance}
            onChange={(e) => setUseOtherInstance(e.target.value)}
            disabled={toggling}
            className={cn(selectCls, "w-auto")}
          >
            <option value="">Choose a number…</option>
            {otherInstances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => turnOn(useOtherInstance)}
            disabled={toggling || !useOtherInstance}
          >
            Turn on
          </Button>
        </div>
      )}
    </div>
  );
}
