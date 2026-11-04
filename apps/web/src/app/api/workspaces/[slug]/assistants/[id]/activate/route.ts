import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { activateAssistant, deactivateAssistant } from "@/lib/activate-assistant";

const body = z.object({ instanceId: z.string() });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const inst = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!inst) return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 404 });
    await activateAssistant(workspace.id, id, parsed.data.instanceId);
    return NextResponse.json({ ok: true });
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
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    await deactivateAssistant(workspace.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
