import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const bodySchema = z.object({ userId: z.string().nullable() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");

    await db.conversation.update({ where: { id }, data: { assignedToUserId: parsed.data.userId } });
    if (parsed.data.userId) {
      await db.assignment.create({ data: { conversationId: id, userId: parsed.data.userId } as any });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
