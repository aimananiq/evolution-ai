import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { sendViaInstance } from "@evo/send";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  instanceId: z.string(),
  to: z.string().min(5),
  text: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const result = await sendViaInstance(parsed.data.instanceId, {
      type: "text",
      to: parsed.data.to,
      text: parsed.data.text,
      userId: null,
    });
    return NextResponse.json({ ok: true, messageId: (result as any)?.key?.id ?? null });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    return NextResponse.json({ error: "SEND_FAILED" }, { status: 502 });
  }
}
