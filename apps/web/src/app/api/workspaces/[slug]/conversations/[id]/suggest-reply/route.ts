import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { resolveAiKey } from "@/lib/ai-key";
import { buildSuggestRequest } from "@/lib/suggest-reply";
import { claudeReply } from "@evo/ai";
import { retrieveContext } from "@evo/kb";
import { AppError, NotFoundError } from "@evo/shared";

const RECENT_LIMIT = 12;

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);

    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");

    const recentDesc = await db.message.findMany({
      where: { conversationId: id },
      orderBy: { sentAt: "desc" },
      take: RECENT_LIMIT,
      select: { direction: true, body: true },
    });

    const chatbot = await db.chatbot.findUnique({
      where: { instanceId: conv.instanceId },
      select: { systemPrompt: true, fallbackModel: true },
    });
    const aiKeyRow =
      (await db.workspaceAiKey.findUnique({ where: { workspaceId_scope: { workspaceId: workspace.id, scope: "chatbot" } }, select: { defaultModel: true } })) ??
      (await db.workspaceAiKey.findUnique({ where: { workspaceId_scope: { workspaceId: workspace.id, scope: "default" } }, select: { defaultModel: true } }));

    const chronological = recentDesc.reverse();

    // Ground the draft in the workspace knowledge base (best-effort).
    let knowledgeBlock = "";
    try {
      const lastInbound = [...chronological].reverse().find((m) => m.direction === "inbound" && (m.body ?? "").trim());
      const query = lastInbound?.body
        ?? chronological.filter((m) => m.direction === "inbound").map((m) => m.body ?? "").join(" ");
      if (query.trim()) {
        const snippets = await db.knowledgeSnippet.findMany({
          where: { enabled: true },
          select: { id: true, title: true, content: true },
          take: 100,
        });
        knowledgeBlock = retrieveContext(query, snippets).block;
      }
    } catch {
      /* KB lookup failed — draft without grounding */
    }

    const request = buildSuggestRequest(
      chronological,
      chatbot,
      aiKeyRow?.defaultModel ?? null,
      knowledgeBlock,
    );
    if (!request) return NextResponse.json({ error: "NO_CONTEXT" }, { status: 422 });

    const apiKey = await resolveAiKey(workspace.id, "claude");
    if (!apiKey) return NextResponse.json({ error: "NO_AI_KEY" }, { status: 400 });

    try {
      const suggestion = await claudeReply({
        model: request.model,
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        maxTokens: 400,
        apiKey,
      });
      return NextResponse.json({ suggestion: suggestion.trim() });
    } catch {
      return NextResponse.json({ error: "AI_ERROR" }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
