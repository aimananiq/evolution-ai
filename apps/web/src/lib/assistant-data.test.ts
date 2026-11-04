import { describe, it, expect, vi, beforeEach } from "vitest";
const findMany = vi.fn();
vi.mock("@evo/db", () => ({
  tenantClient: () => ({ chatTopic: { findMany }, instance: { findMany: vi.fn() } }),
}));
const { toAssistantSummaries } = await import("./assistant-data");
beforeEach(() => vi.clearAllMocks());

describe("toAssistantSummaries", () => {
  it("marks a topic live when an enabled chatbot with AI references it", () => {
    const topics = [{
      id: "t1", name: "YLP", personaTone: "warm, friendly and approachable",
      _count: { snippets: 28 },
      chatbots: [{ enabled: true, fallbackProvider: "claude", instance: { label: "iPhone 11" } }],
    }];
    const [a] = toAssistantSummaries(topics as any);
    expect(a!.status).toBe("live");
    expect(a!.liveOn).toBe("iPhone 11");
    expect(a!.knowledgeCount).toBe(28);
  });
  it("marks a topic draft when no enabled chatbot references it", () => {
    const topics = [{ id: "t2", name: "Draft", personaTone: null, _count: { snippets: 3 }, chatbots: [] }];
    const [a] = toAssistantSummaries(topics as any);
    expect(a!.status).toBe("draft");
    expect(a!.liveOn).toBeNull();
  });
  it("treats enabled-but-AI-off (fallbackProvider none) as NOT live", () => {
    const topics = [{ id: "t3", name: "X", personaTone: null, _count: { snippets: 1 },
      chatbots: [{ enabled: true, fallbackProvider: "none", instance: { label: "S21" } }] }];
    expect(toAssistantSummaries(topics as any)[0]!.status).toBe("draft");
  });
});
