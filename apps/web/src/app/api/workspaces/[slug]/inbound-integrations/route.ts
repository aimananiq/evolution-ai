import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const createSchema = z.object({
  instanceId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  recipientPathKey: z.string().min(1).default("billing.billing_phone"),
  captionTemplate: z.string().default(""),
  mediaAssetId: z.string().optional(),
  enabled: z.boolean().default(true),
});

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const rows = await db.inboundIntegration.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, enabled: true, instanceId: true, recipientPathKey: true, lastReceivedAt: true, createdAt: true },
    });
    return NextResponse.json({ integrations: rows });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");
    const token = randomBytes(24).toString("base64url");
    const row = await db.inboundIntegration.create({
      data: {
        instanceId: parsed.data.instanceId,
        name: parsed.data.name ?? `Webhook #${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
        description: parsed.data.description,
        token,
        enabled: parsed.data.enabled,
        recipientPathKey: parsed.data.recipientPathKey,
        captionTemplate: parsed.data.captionTemplate,
        mediaAssetId: parsed.data.mediaAssetId,
      } as any,
    });
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
