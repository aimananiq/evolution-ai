export interface TopicGuardrails {
  stayOnTopic: boolean;
  answerOnlyFromKnowledge: boolean;
  handoff: { enabled: boolean; triggers: string[]; onUnsure: boolean };
  neverSay: string[];
  fallbackMessage: string;
}

export const DEFAULT_GUARDRAILS: TopicGuardrails = {
  stayOnTopic: true,
  answerOnlyFromKnowledge: true,
  handoff: { enabled: true, triggers: ["talk to human", "agent", "complaint"], onUnsure: true },
  neverSay: [],
  fallbackMessage: "Let me connect you with our team — please hold on. 🙏",
};

export function buildTopicSystemPrompt(input: {
  personaTone?: string | null;
  guardrails: TopicGuardrails;
  knowledge: string;
}): string {
  const g = input.guardrails;
  const lines: string[] = [];
  lines.push("You are a WhatsApp customer-service assistant.");
  if (input.personaTone) lines.push(`Style: ${input.personaTone}.`);
  if (g.stayOnTopic) lines.push("Only answer questions within your topic. Politely decline anything off-topic and point the person to the right channel.");
  if (g.answerOnlyFromKnowledge) {
    lines.push("Answer ONLY from the KNOWLEDGE below. If the answer is not clearly in it, reply EXACTLY with the fallback message and nothing else. Never guess fees, dates, or make promises.");
  }
  if (g.neverSay.length) lines.push(`Never say any of the following: ${g.neverSay.map((s) => `"${s}"`).join(", ")}.`);
  lines.push(`Fallback message: "${g.fallbackMessage}"`);
  lines.push("");
  lines.push("KNOWLEDGE:");
  lines.push(input.knowledge?.trim() || "(no knowledge provided)");
  return lines.join("\n");
}

/** True if the inbound text should trigger a human handoff. */
export function shouldHandoff(text: string, g: TopicGuardrails): boolean {
  if (!g.handoff.enabled) return false;
  const t = (text ?? "").toLowerCase();
  return g.handoff.triggers.some((k) => k && t.includes(k.toLowerCase()));
}
