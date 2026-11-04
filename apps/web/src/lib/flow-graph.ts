/**
 * Pure layout for the visual flow builder — turns a chatbot's triggers + fallback config
 * into a node/edge graph. No React or I/O so it can be unit-tested.
 */

export interface FlowTrigger {
  id: string;
  keyword: string;
  matchType: "exact" | "contains" | "startsWith";
  response: string | null;
  actionCount: number;
}

export interface FlowChatbot {
  fallbackProvider: "none" | "claude" | "openai";
  triggers: FlowTrigger[];
  autoresponderEnabled: boolean;
}

export type FlowNodeKind = "root" | "trigger" | "fallback" | "autoresponder";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  sublabel?: string;
  triggerId?: string;
  x: number;
  y: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

const COL = { root: 0, trigger: 320, terminal: 680 };
const ROW = 120;

function triggerSummary(t: FlowTrigger): string {
  if (t.actionCount > 0) return `${t.actionCount} action${t.actionCount === 1 ? "" : "s"}`;
  const r = (t.response ?? "").trim();
  return r ? (r.length > 60 ? r.slice(0, 60) + "…" : r) : "(no response)";
}

export function buildFlowGraph(chatbot: FlowChatbot): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const rootY = Math.max(0, ((chatbot.triggers.length - 1) * ROW) / 2);
  nodes.push({ id: "root", kind: "root", label: "Incoming message", x: COL.root, y: rootY });

  chatbot.triggers.forEach((t, i) => {
    const nodeId = `trigger:${t.id}`;
    nodes.push({
      id: nodeId,
      kind: "trigger",
      label: `${t.matchType} "${t.keyword}"`,
      sublabel: triggerSummary(t),
      triggerId: t.id,
      x: COL.trigger,
      y: i * ROW,
    });
    edges.push({ id: `e:root:${nodeId}`, source: "root", target: nodeId });
  });

  const terminals: FlowNode[] = [];
  if (chatbot.fallbackProvider !== "none") {
    terminals.push({
      id: "fallback",
      kind: "fallback",
      label: chatbot.fallbackProvider === "claude" ? "AI reply (Claude)" : "AI reply (OpenAI)",
      sublabel: "when no keyword matches",
      x: COL.terminal,
      y: 0,
    });
  }
  if (chatbot.autoresponderEnabled) {
    terminals.push({
      id: "autoresponder",
      kind: "autoresponder",
      label: "Autoresponder",
      sublabel: "lowest-priority fallback",
      x: COL.terminal,
      y: terminals.length * ROW,
    });
  }
  for (const term of terminals) {
    nodes.push(term);
    edges.push({ id: `e:root:${term.id}`, source: "root", target: term.id });
  }

  return { nodes, edges };
}
