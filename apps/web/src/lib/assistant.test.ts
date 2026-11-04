import { describe, it, expect } from "vitest";
import { VOICES, toneForVoice, voiceForTone, sizeLabel, buildGuardrails } from "./assistant";
import { DEFAULT_GUARDRAILS } from "@evo/kb";

describe("voice presets", () => {
  it("maps each voice to a tone string and back", () => {
    expect(VOICES.map((v) => v.id)).toEqual(["friendly", "professional", "playful"]);
    for (const v of VOICES) expect(voiceForTone(toneForVoice(v.id))).toBe(v.id);
  });
  it("defaults unknown tone to friendly", () => {
    expect(voiceForTone(null)).toBe("friendly");
    expect(voiceForTone("something custom")).toBe("friendly");
  });
});

describe("sizeLabel", () => {
  it("relabels token tiers as plain sizes", () => {
    expect(sizeLabel(1_000).label).toBe("Small");
    expect(sizeLabel(60_000).label).toBe("Medium");
    expect(sizeLabel(200_000).label).toBe("Large");
  });
  it("small is the reassuring/cheap tier", () => {
    expect(sizeLabel(1_000).tone).toBe("good");
  });
});

describe("buildGuardrails", () => {
  it("starts from DEFAULT_GUARDRAILS and applies the two plain toggles", () => {
    const g = buildGuardrails({ onlyFromKnowledge: true, handoff: true, handoffMessage: "Hold on 🙏" });
    expect(g.answerOnlyFromKnowledge).toBe(true);
    expect(g.handoff.enabled).toBe(true);
    expect(g.handoff.onUnsure).toBe(true);
    expect(g.fallbackMessage).toBe("Hold on 🙏");
    expect(g.stayOnTopic).toBe(DEFAULT_GUARDRAILS.stayOnTopic);
  });
  it("off toggles disable cleanly", () => {
    const g = buildGuardrails({ onlyFromKnowledge: false, handoff: false, handoffMessage: "" });
    expect(g.answerOnlyFromKnowledge).toBe(false);
    expect(g.handoff.enabled).toBe(false);
    expect(g.handoff.onUnsure).toBe(false);
  });
});
