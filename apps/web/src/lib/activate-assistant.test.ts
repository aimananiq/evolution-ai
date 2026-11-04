import { describe, it, expect, vi, beforeEach } from "vitest";
const upsert = vi.fn(); const updateMany = vi.fn();
vi.mock("@evo/db", () => ({ tenantClient: () => ({ chatbot: { upsert, updateMany } }) }));
const { activateAssistant, deactivateAssistant } = await import("./activate-assistant");
beforeEach(() => vi.clearAllMocks());

describe("activateAssistant", () => {
  it("upserts the chatbot with enabled + topicId + AI on, in one call", async () => {
    await activateAssistant("ws1", "topic1", "inst1");
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ instanceId: "inst1" });
    expect(arg.create).toMatchObject({ instanceId: "inst1", topicId: "topic1", enabled: true, fallbackProvider: "claude" });
    expect(arg.update).toMatchObject({ topicId: "topic1", enabled: true, fallbackProvider: "claude" });
  });
});
describe("deactivateAssistant", () => {
  it("disables all chatbots for this topic without deleting them", async () => {
    await deactivateAssistant("ws1", "topic1");
    expect(updateMany).toHaveBeenCalledWith({ where: { topicId: "topic1" }, data: { enabled: false } });
  });
});
