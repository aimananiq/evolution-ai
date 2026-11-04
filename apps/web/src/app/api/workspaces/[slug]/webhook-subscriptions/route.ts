import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { assertPublicUrl, ssrfAllowHosts } from "@evo/shared/ssrf";

const VALID_EVENTS = [
  "message.received",
  "message.sent",
  "message.status",
  "instance.state",
  "broadcast.completed",
  "broadcast.failed",
  "health.at_risk",
  "health.auto_protected",
  "health.ramp_cap_reached",
];

const schema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(VALID_EVENTS as [string, ...string[]])).min(1),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const subs = await db.webhookSubscription.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, url: true, events: true, enabled: true, createdAt: true },
    });
    return NextResponse.json({ subscriptions: subs });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    // SSRF guard: the delivery worker POSTs to this URL server-side.
    const safe = await assertPublicUrl(parsed.data.url, ssrfAllowHosts());
    if (!safe.ok) return NextResponse.json({ error: "URL_NOT_ALLOWED", detail: safe.reason }, { status: 400 });
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const db = tenantClient(workspace.id);
    const sub = await db.webhookSubscription.create({
      data: {
        url: parsed.data.url,
        events: parsed.data.events,
        secret,
        enabled: true,
      } as any,
      select: { id: true, url: true, events: true, enabled: true, createdAt: true },
    });
    return NextResponse.json({ subscription: sub, secret }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
