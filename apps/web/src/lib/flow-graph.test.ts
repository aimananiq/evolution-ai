import { describe, it, expect } from "vitest";
import { buildFlowGraph, type FlowChatbot } from "./flow-graph";

const trigger = (id: string, over: Partial<FlowChatbot["triggers"][0]> = {}) => ({
  id,
  keyword: "hi",
  matchType: "contains" as const,
  response: "Hello!",
  actionCount: 0,
  ...over,
});

describe("buildFlowGraph", () => {
  it("always has a root node", () => {
    const { nodes } = buildFlowGraph({ fallbackProvider: "none", triggers: [], autoresponderEnabled: false });
    expect(nodes.find((n) => n.kind === "root")).toBeTruthy();
  });

  it("emits one trigger node and one root edge per trigger", () => {
    const { nodes, edges } = buildFlowGraph({
      fallbackProvider: "none",
      autoresponderEnabled: false,
      triggers: [trigger("a"), trigger("b")],
    });
    const triggerNodes = nodes.filter((n) => n.kind === "trigger");
    expect(triggerNodes.map((n) => n.triggerId)).toEqual(["a", "b"]);
    expect(edges.filter((e) => e.source === "root" && e.target.startsWith("trigger:"))).toHaveLength(2);
  });

  it("summarises action count when actions exist, else the response text", () => {
    const { nodes } = buildFlowGraph({
      fallbackProvider: "none",
      autoresponderEnabled: false,
      triggers: [trigger("a", { actionCount: 3 }), trigger("b", { actionCount: 0, response: "Hi there" })],
    });
    const byId = Object.fromEntries(nodes.filter((n) => n.kind === "trigger").map((n) => [n.triggerId, n.sublabel]));
    expect(byId["a"]).toBe("3 actions");
    expect(byId["b"]).toBe("Hi there");
  });

  it("adds a fallback node only when a provider is set", () => {
    expect(buildFlowGraph({ fallbackProvider: "none", triggers: [], autoresponderEnabled: false }).nodes.some((n) => n.kind === "fallback")).toBe(false);
    expect(buildFlowGraph({ fallbackProvider: "claude", triggers: [], autoresponderEnabled: false }).nodes.some((n) => n.kind === "fallback")).toBe(true);
  });

  it("adds an autoresponder node only when enabled", () => {
    expect(buildFlowGraph({ fallbackProvider: "none", triggers: [], autoresponderEnabled: false }).nodes.some((n) => n.kind === "autoresponder")).toBe(false);
    expect(buildFlowGraph({ fallbackProvider: "none", triggers: [], autoresponderEnabled: true }).nodes.some((n) => n.kind === "autoresponder")).toBe(true);
  });
});
