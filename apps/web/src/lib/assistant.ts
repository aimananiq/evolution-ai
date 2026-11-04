import { DEFAULT_GUARDRAILS, meterTier, type TopicGuardrails } from "@evo/kb";

export type VoiceId = "friendly" | "professional" | "playful";

export const VOICES: { id: VoiceId; label: string; tone: string }[] = [
  { id: "friendly", label: "Friendly", tone: "warm, friendly and approachable" },
  { id: "professional", label: "Professional", tone: "professional, concise and polite" },
  { id: "playful", label: "Playful", tone: "playful, upbeat and casual" },
];

export function toneForVoice(id: VoiceId): string {
  return VOICES.find((v) => v.id === id)?.tone ?? VOICES[0]!.tone;
}

export function voiceForTone(tone: string | null | undefined): VoiceId {
  return VOICES.find((v) => v.tone === tone)?.id ?? "friendly";
}

export function sizeLabel(tokens: number): { label: "Small" | "Medium" | "Large"; hint: string; tone: "good" | "warn" | "high" } {
  const tier = meterTier(tokens);
  if (tier === "green") return { label: "Small", hint: "fast & low cost", tone: "good" };
  if (tier === "amber") return { label: "Medium", hint: "still fine — a bit slower", tone: "warn" };
  return { label: "Large", hint: "slower & pricier — consider trimming", tone: "high" };
}

export function buildGuardrails(opts: { onlyFromKnowledge: boolean; handoff: boolean; handoffMessage: string }): TopicGuardrails {
  const base = DEFAULT_GUARDRAILS;
  return {
    ...base,
    answerOnlyFromKnowledge: opts.onlyFromKnowledge,
    handoff: { ...base.handoff, enabled: opts.handoff, onUnsure: opts.handoff },
    fallbackMessage: opts.handoffMessage.trim() || base.fallbackMessage,
  };
}
