import { describe, it, expect } from "vitest";
import { buildTopicSystemPrompt, type TopicGuardrails } from "./topic-prompt";

const base: TopicGuardrails = {
  stayOnTopic: true,
  answerOnlyFromKnowledge: true,
  handoff: { enabled: true, triggers: ["human"], onUnsure: true },
  neverSay: ["guaranteed scholarship"],
  fallbackMessage: "Let me connect you with our team.",
};

describe("buildTopicSystemPrompt", () => {
  it("includes persona, knowledge, and the anti-hallucination rule", () => {
    const p = buildTopicSystemPrompt({ personaTone: "polite, short", guardrails: base, knowledge: "Fees: RM5000." });
    expect(p).toContain("polite, short");
    expect(p).toContain("Fees: RM5000.");
    expect(p.toLowerCase()).toContain("only");
    expect(p).toContain("Let me connect you with our team.");
    expect(p).toContain("guaranteed scholarship");
  });
  it("omits the knowledge-only rule when disabled", () => {
    const p = buildTopicSystemPrompt({ guardrails: { ...base, answerOnlyFromKnowledge: false }, knowledge: "" });
    expect(p.toLowerCase()).not.toContain("only from the knowledge");
  });
});
