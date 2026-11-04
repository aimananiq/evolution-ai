import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { actionsSchema } from "@evo/flow-actions";

const schema = z.object({
  keyword: z.string().min(1).max(80).optional(),
  matchType: z.enum(["exact", "contains", "startsWith"]).optional(),
  response: z.string().min(1).max(4000).optional(),
  name: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  sendTo: z.enum(["all", "individual", "group"]).optional(),
  isDefaultReply: z.boolean().optional(),
  presenceDelaySec: z.number().int().min(0).max(30).optional(),
  mediaAssetId: z.string().nullable().optional(),
  actions: actionsSchema.optional(),
});

async function ensureOwnership(workspaceId: string, chatbotId: string, triggerId: string) {
  const db = tenantClient(workspaceId);
  const chatbot = await db.chatbot.findUnique({ where: { id: chatbotId } });
  if (!chatbot) throw new NotFoundError("Chatbot not found");
  const trigger = await prisma.keywordTrigger.findUnique({ where: { id: triggerId } });
  if (!trigger || trigger.chatbotId !== chatbotId) throw new NotFoundError("Trigger not found");
  return trigger;
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string; triggerId: string }> }) {
  const { slug, id, triggerId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    await ensureOwnership(workspace.id, id, triggerId);
    const trigger = await prisma.keywordTrigger.update({ where: { id: triggerId }, data: parsed.data });
    return NextResponse.json({ trigger });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string; triggerId: string }> }) {
  const { slug, id, triggerId } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    await ensureOwnership(workspace.id, id, triggerId);
    await prisma.keywordTrigger.delete({ where: { id: triggerId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
