import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { actionsSchema } from "@evo/flow-actions";

const schema = z.object({
  keyword: z.string().min(1).max(80),
  matchType: z.enum(["exact", "contains", "startsWith"]).default("contains"),
  response: z.string().min(1).max(4000),
  name: z.string().max(120).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  sendTo: z.enum(["all", "individual", "group"]).default("all"),
  isDefaultReply: z.boolean().default(false),
  presenceDelaySec: z.number().int().min(0).max(30).default(0),
  mediaAssetId: z.string().optional().nullable(),
  actions: actionsSchema.default([]),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const triggers = await prisma.keywordTrigger.findMany({
      where: { chatbotId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ triggers });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const d = parsed.data;
    const trigger = await prisma.keywordTrigger.create({
      data: {
        chatbotId: id,
        keyword: d.keyword,
        matchType: d.matchType,
        response: d.response,
        name: d.name ?? null,
        description: d.description ?? null,
        sendTo: d.sendTo,
        isDefaultReply: d.isDefaultReply,
        presenceDelaySec: d.presenceDelaySec,
        mediaAssetId: d.mediaAssetId ?? null,
        actions: d.actions,
      },
    });
    return NextResponse.json({ trigger }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
