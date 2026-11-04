import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance } from "@/lib/send";
import { emitWebhook } from "@evo/webhooks";
import { AppError, NotFoundError } from "@evo/shared";

const replySchema = z.object({ text: z.string().min(1).max(4000) });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    const messages = await db.message.findMany({
      where: { conversationId: id },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ messages: messages.reverse() });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const parsed = replySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });

    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");

    const message = await db.message.create({
      data: {
        conversationId: id,
        direction: "outbound",
        type: "text",
        body: parsed.data.text,
        status: "pending",
        sentByUserId: userId,
      } as any,
    });

    try {
      await sendViaInstance(conv.instanceId, {
        type: "text",
        to: conv.contactPhone,
        text: parsed.data.text,
        userId,
      });
      const updated = await prisma.message.update({ where: { id: message.id }, data: { status: "sent" } });
      await db.conversation.update({
        where: { id },
        data: { lastMessageAt: new Date(), unreadCount: 0 },
      });
      void emitWebhook(workspace.id, "message.sent", {
        instanceId: conv.instanceId,
        conversationId: id,
        to: conv.contactPhone,
        textPreview: parsed.data.text.slice(0, 200),
      });
      return NextResponse.json({ message: updated }, { status: 201 });
    } catch (err: any) {
      await prisma.message.update({ where: { id: message.id }, data: { status: "failed" } });
      if (String(err?.message ?? "").startsWith("throttled")) {
        return NextResponse.json({ error: "THROTTLED" }, { status: 429 });
      }
      return NextResponse.json({ error: "SEND_FAILED" }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
