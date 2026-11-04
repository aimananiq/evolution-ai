import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";
import { renderTemplate, normalisePhone } from "@evo/inbound-templating";
import { sendViaInstance } from "@evo/send";

const schema = z.object({ to: z.string().min(3) });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const to = normalisePhone(parsed.data.to);
    if (!to) return NextResponse.json({ error: "INVALID_RECIPIENT" }, { status: 400 });

    const db = tenantClient(workspace.id);
    const integ = await db.inboundIntegration.findUnique({ where: { id } });
    if (!integ) throw new NotFoundError("Integration not found");

    const sample = (integ.lastSamplePayload as unknown) ?? {};
    const text = renderTemplate(integ.captionTemplate, sample) || "(test message)";

    await sendViaInstance(integ.instanceId, { type: "text", to, text, userId: null });
    return NextResponse.json({ ok: true, sent: { to, text } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: "SEND_FAILED", detail: e.message }, { status: 502 });
    throw e;
  }
}
