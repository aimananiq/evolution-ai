import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { chunkText, estimateTokens } from "@evo/kb";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const createSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("faq"),
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(4000),
  }),
  z.object({
    type: z.literal("text"),
    label: z.string().trim().max(120).optional(),
    content: z.string().trim().min(1).max(50000),
  }),
]);

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const rows = await db.knowledgeSnippet.findMany({
      where: { topicId: id },
      orderBy: { createdAt: "asc" },
    });
    const totalTokens = rows.reduce((sum, s) => sum + estimateTokens(s.content), 0);
    return NextResponse.json({
      snippets: rows.map((s) => ({
        id: s.id,
        title: s.title,
        content: s.content,
        sourceType: s.sourceType,
        sourceLabel: s.sourceLabel,
        enabled: s.enabled,
        chars: s.content.length,
      })),
      totalTokens,
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "not found" }, { status: 404 });

    let inserted = 0;
    if (parsed.data.type === "faq") {
      await db.knowledgeSnippet.create({
        data: {
          topicId: id,
          title: parsed.data.question,
          content: parsed.data.answer,
          sourceType: "faq",
        } as any,
      });
      inserted = 1;
    } else {
      const label = parsed.data.label || "Text";
      const chunks = chunkText(parsed.data.content);
      const rows = chunks.map((chunk, i) => ({
        topicId: id,
        title: `${label} #${i + 1}`,
        content: chunk,
        sourceType: "text",
        sourceLabel: label,
      }));
      if (rows.length) {
        await db.knowledgeSnippet.createMany({ data: rows as any });
      }
      inserted = rows.length;
    }
    return NextResponse.json({ inserted }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const url = new URL(req.url);
    const snippetId = url.searchParams.get("id");
    const sourceLabel = url.searchParams.get("sourceLabel");
    if (snippetId) {
      await db.knowledgeSnippet.deleteMany({ where: { id: snippetId, topicId: id } });
    } else if (sourceLabel !== null) {
      await db.knowledgeSnippet.deleteMany({ where: { topicId: id, sourceLabel } });
    } else {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
