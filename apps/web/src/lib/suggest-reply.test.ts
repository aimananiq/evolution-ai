import { describe, it, expect } from "vitest";
import { buildSuggestRequest, DEFAULT_SUGGEST_MODEL } from "./suggest-reply";

const inbound = (body: string | null) => ({ direction: "inbound" as const, body });
const outbound = (body: string | null) => ({ direction: "outbound" as const, body });

describe("buildSuggestRequest", () => {
  it("maps inbound→user and outbound→assistant and drops empty bodies", () => {
    const r = buildSuggestRequest(
      [inbound("Hi"), outbound("Hello!"), inbound("  "), inbound("Price?")],
      null,
      null,
    );
    expect(r).not.toBeNull();
    expect(r!.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Price?" },
    ]);
  });

  it("returns null when there is no usable context", () => {
    expect(buildSuggestRequest([], null, null)).toBeNull();
    expect(buildSuggestRequest([inbound(""), outbound("   ")], null, null)).toBeNull();
  });

  it("drops leading assistant turns so the history starts on a user turn", () => {
    const r = buildSuggestRequest([outbound("Welcome!"), inbound("Hi")], null, null);
    expect(r!.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("returns null when only assistant turns remain", () => {
    expect(buildSuggestRequest([outbound("Welcome!")], null, null)).toBeNull();
  });

  it("selects model: chatbot.fallbackModel > workspace default > constant", () => {
    expect(buildSuggestRequest([inbound("x")], { systemPrompt: null, fallbackModel: "claude-sonnet-4-6" }, "claude-fable-5")!.model)
      .toBe("claude-sonnet-4-6");
    expect(buildSuggestRequest([inbound("x")], { systemPrompt: null, fallbackModel: null }, "claude-fable-5")!.model)
      .toBe("claude-fable-5");
    expect(buildSuggestRequest([inbound("x")], null, null)!.model).toBe(DEFAULT_SUGGEST_MODEL);
  });

  it("injects the knowledge block between the base prompt and the reply-only suffix", () => {
    const r = buildSuggestRequest(
      [inbound("what are your hours?")],
      { systemPrompt: "You are Acme support.", fallbackModel: null },
      null,
      "Use the following business information...\n\n- Hours: 9-6 Mon-Fri",
    )!;
    const promptStart = r.systemPrompt.indexOf("You are Acme support.");
    const kbStart = r.systemPrompt.indexOf("Hours: 9-6 Mon-Fri");
    const suffixStart = r.systemPrompt.indexOf("Output only the message text");
    expect(promptStart).toBeGreaterThanOrEqual(0);
    expect(kbStart).toBeGreaterThan(promptStart);
    expect(suffixStart).toBeGreaterThan(kbStart);
  });

  it("omits grounding when the knowledge block is empty", () => {
    const r = buildSuggestRequest([inbound("hi")], null, null, "")!;
    expect(r.systemPrompt).toContain("customer-support agent");
    expect(r.systemPrompt).toContain("Output only the message text");
  });

  it("uses the chatbot system prompt when set, else a default, and always appends the reply-only suffix", () => {
    const withBot = buildSuggestRequest([inbound("x")], { systemPrompt: "You are Acme support.", fallbackModel: null }, null)!;
    expect(withBot.systemPrompt).toContain("You are Acme support.");
    expect(withBot.systemPrompt).toContain("Output only the message text");

    const withoutBot = buildSuggestRequest([inbound("x")], null, null)!;
    expect(withoutBot.systemPrompt).toContain("customer-support agent");
    expect(withoutBot.systemPrompt).toContain("Output only the message text");
  });
});
