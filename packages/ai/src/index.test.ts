import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMock }; },
}));

import { claudeReply } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("claudeReply", () => {
  it("calls Anthropic with the system prompt + messages and returns the assistant text", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "Hi there!" }],
    });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(reply).toBe("Hi there!");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-4-5-20251001",
      system: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    }));
  });

  it("returns empty string if Anthropic returns no text block", async () => {
    createMock.mockResolvedValue({ content: [{ type: "tool_use" }] });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
    });
    expect(reply).toBe("");
  });

  it("throws if ANTHROPIC_API_KEY missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
    })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("uses input.apiKey when provided, overriding env", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    createMock.mockResolvedValue({ content: [{ type: "text", text: "Hi!" }] });
    const reply = await claudeReply({
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "x",
      messages: [{ role: "user", content: "x" }],
      apiKey: "override-key",
    });
    expect(reply).toBe("Hi!");
  });
});
