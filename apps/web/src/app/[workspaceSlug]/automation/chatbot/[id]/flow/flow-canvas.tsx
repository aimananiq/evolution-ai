"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildFlowGraph, type FlowChatbot, type FlowNode } from "@/lib/flow-graph";

const KIND_CLASS: Record<string, string> = {
  root: "border-primary bg-primary/10",
  trigger: "border-border bg-card",
  fallback: "border-violet-400/50 bg-violet-400/10",
  autoresponder: "border-amber-400/50 bg-amber-400/10",
};

export default function FlowCanvas({
  workspaceSlug,
  instanceId,
  chatbotId,
  initial,
}: {
  workspaceSlug: string;
  instanceId: string;
  chatbotId: string;
  initial: FlowChatbot;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [chatbot, setChatbot] = useState<FlowChatbot>(initial);
  const [busy, setBusy] = useState(false);

  async function refetch() {
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers`);
    if (res.ok) {
      const { triggers } = await res.json();
      setChatbot((c) => ({
        ...c,
        triggers: triggers.map((tr: any) => ({
          id: tr.id,
          keyword: tr.keyword,
          matchType: tr.matchType,
          response: tr.response,
          actionCount: Array.isArray(tr.actions) ? tr.actions.length : 0,
        })),
      }));
    }
  }

  async function addTrigger() {
    const keyword = prompt(t("flow.newKeyword"));
    if (!keyword?.trim()) return;
    const response = prompt(t("flow.newResponse")) ?? "";
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword: keyword.trim(), response: response.trim() || keyword.trim() }),
    });
    setBusy(false);
    if (res.ok) await refetch();
    else alert(t("flow.addFailed"));
  }

  const removeTrigger = useCallback(
    async (triggerId: string) => {
      if (!confirm(t("flow.confirmDelete"))) return;
      await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers/${triggerId}`, { method: "DELETE" });
      await refetch();
    },
    [workspaceSlug, chatbotId, t],
  );

  const graph = useMemo(() => buildFlowGraph(chatbot), [chatbot]);

  const nodes: Node[] = graph.nodes.map((n: FlowNode) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: {
      label: (
        <div className="text-left">
          <div className="text-xs font-medium">{n.label}</div>
          {n.sublabel && <div className="text-[10px] text-muted-foreground">{n.sublabel}</div>}
          {n.kind === "trigger" && n.triggerId && (
            <button
              onClick={(e) => { e.stopPropagation(); removeTrigger(n.triggerId!); }}
              className="mt-1 text-[10px] text-destructive underline"
            >
              {t("common.delete")}
            </button>
          )}
        </div>
      ),
    },
    className: `rounded-md border px-3 py-2 ${KIND_CLASS[n.kind] ?? ""}`,
    sourcePosition: "right" as any,
    targetPosition: "left" as any,
  }));

  const edges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, animated: true }));

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const gn = graph.nodes.find((n) => n.id === node.id);
      if (gn?.kind === "trigger") router.push(`/${workspaceSlug}/automation/chatbot/${instanceId}#trigger-${gn.triggerId}`);
      if (gn?.kind === "fallback") router.push(`/${workspaceSlug}/automation/chatbot/${instanceId}/settings`);
      if (gn?.kind === "autoresponder") router.push(`/${workspaceSlug}/autoresponder`);
    },
    [graph.nodes, router, workspaceSlug, instanceId],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button onClick={addTrigger} disabled={busy} className="bg-primary text-primary-foreground rounded p-2 px-4 disabled:opacity-50">
          {t("flow.addTrigger")}
        </button>
        <span className="text-sm text-muted-foreground">{t("flow.hint")}</span>
      </div>
      <div style={{ height: 560 }} className="border rounded">
        <ReactFlow nodes={nodes} edges={edges} onNodeClick={onNodeClick} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
