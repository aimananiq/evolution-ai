import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { DEFAULT_GUARDRAILS } from "@evo/kb";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const rows = await db.chatTopic.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { snippets: true, chatbots: true } } },
    });
    return NextResponse.json({
      topics: rows.map((t) => ({
        id: t.id,
        name: t.name,
        personaTone: t.personaTone,
        greeting: t.greeting,
        guardrails: t.guardrails,
        snippetCount: t._count.snippets,
        chatbotCount: t._count.chatbots,
      })),
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.chatTopic.findFirst({ where: { name: parsed.data.name } });
    if (existing) return NextResponse.json({ error: "TOPIC_EXISTS" }, { status: 409 });
    const topic = await db.chatTopic.create({
      data: { name: parsed.data.name, guardrails: DEFAULT_GUARDRAILS as any } as any,
    });
    return NextResponse.json({ topic: { id: topic.id, name: topic.name } }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
