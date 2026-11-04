import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { resolveAiConfig, aiChat, defaultModelFor, type AiProvider } from "@evo/ai";
import { retrieveContext, buildTopicSystemPrompt, type TopicGuardrails } from "@evo/kb";

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const { message } = parsed.data;

    const db = tenantClient(workspace.id);
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "not found" }, { status: 404 });

    const guardrails = topic.guardrails as unknown as TopicGuardrails;

    const snippets = await db.knowledgeSnippet.findMany({
      where: { topicId: topic.id, enabled: true },
      select: { id: true, title: true, content: true },
    });
    // Mirror the engine: bare grounding block (no general-knowledge preamble).
    const { block, used } = retrieveContext(message, snippets, { bare: true });
    const usedSnippets = used.map((s) => s.title);

    // Mirror the engine: answer-only-from-knowledge with no matching knowledge → fall back.
    if (guardrails.answerOnlyFromKnowledge && !block?.trim()) {
      return NextResponse.json({
        reply: guardrails.fallbackMessage,
        fellBack: true,
        usedSnippets,
      });
    }

    const cfg = await resolveAiConfig(workspace.id, "chatbot");
    if (!cfg || (cfg.provider !== "ollama" && !cfg.apiKey)) {
      return NextResponse.json({ error: "NO_AI_CONFIG" }, { status: 400 });
    }

    const system = buildTopicSystemPrompt({ personaTone: topic.personaTone, guardrails, knowledge: block });

    let reply: string;
    try {
      reply = await aiChat({
        provider: cfg.provider as AiProvider,
        apiKey: cfg.apiKey,
        endpoint: cfg.endpoint,
        model: cfg.model || defaultModelFor(cfg.provider as AiProvider),
        system,
        messages: [{ role: "user", content: message }],
        maxTokens: 512,
      });
    } catch (aiErr) {
      return NextResponse.json(
        { error: "AI_ERROR", detail: String((aiErr as Error)?.message ?? aiErr).slice(0, 200) },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply, fellBack: false, usedSnippets });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
