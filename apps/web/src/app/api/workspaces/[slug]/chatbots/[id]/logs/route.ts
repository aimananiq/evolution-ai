import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const querySchema = z.object({
  kind: z.enum(["trigger_matched", "ai_reply", "auto_label", "human_takeover", "follow_up_sent", "action_run"]).optional(),
  conversationId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const logs = await db.botUserLog.findMany({
      where: {
        instanceId: chatbot.instanceId,
        ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.take,
    });
    return NextResponse.json({ logs });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
