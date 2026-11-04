import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  welcomeMessage: z.string().max(2000).optional().nullable(),
  fallbackProvider: z.enum(["none", "claude", "openai"]).optional(),
  fallbackModel: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(4000).optional().nullable(),
  // Settings screenshot additions
  aiTemperature: z.number().min(0).max(2).optional().nullable(),
  aiContextLength: z.number().int().min(1).max(64).optional().nullable(),
  scheduleJson: z.any().optional().nullable(),
  pauseBot: z.boolean().optional(),
  unsubscribeKeyword: z.string().max(80).optional().nullable(),
  limiterJson: z.any().optional().nullable(),
  filterJson: z.any().optional().nullable(),
  topicId: z.string().nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({
      where: { id },
      include: { triggers: { orderBy: { createdAt: "asc" } } },
    });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    return NextResponse.json({ chatbot });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    if (parsed.data.fallbackProvider === "openai") {
      return NextResponse.json({ error: "PROVIDER_NOT_IMPLEMENTED", message: "OpenAI fallback is not implemented yet. Use 'claude' or 'none'." }, { status: 501 });
    }
    const db = tenantClient(workspace.id);
    const existing = await db.chatbot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Chatbot not found");
    if (parsed.data.topicId) {
      const topic = await db.chatTopic.findUnique({ where: { id: parsed.data.topicId } });
      if (!topic) return NextResponse.json({ error: "TOPIC_NOT_FOUND" }, { status: 404 });
    }
    const chatbot = await db.chatbot.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ chatbot });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.chatbot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Chatbot not found");
    await db.chatbot.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
