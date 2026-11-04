import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance } from "@/lib/send";
import { AppError, NotFoundError } from "@evo/shared";

const bodySchema = z.object({
  to: z.string().min(8),
  text: z.string().min(1).max(4000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundError("Instance not found");

    try {
      const result = await sendViaInstance(id, {
        type: "text",
        to: parsed.data.to,
        text: parsed.data.text,
        userId,
      });
      return NextResponse.json({ ok: true, result });
    } catch (err: any) {
      if (String(err?.message ?? "").startsWith("throttled")) {
        return NextResponse.json({ error: "THROTTLED" }, { status: 429 });
      }
      return NextResponse.json({ error: "SEND_FAILED", message: String(err?.message ?? err) }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
