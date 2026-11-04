import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const noteSchema = z.object({ body: z.string().min(1).max(2000) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const db = tenantClient(workspace.id);
    const notes = await db.internalNote.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ notes });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Agent");
    const parsed = noteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const conv = await db.conversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundError("Conversation not found");
    const note = await db.internalNote.create({
      data: { conversationId: id, userId, body: parsed.data.body } as any,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
