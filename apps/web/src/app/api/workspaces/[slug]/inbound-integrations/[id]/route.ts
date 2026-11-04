import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  instanceId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  recipientPathKey: z.string().min(1).optional(),
  captionTemplate: z.string().optional(),
  mediaAssetId: z.string().nullable().optional(),
});

const baseUrl = () => process.env.WEBHOOK_PUBLIC_BASE_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const row = await db.inboundIntegration.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Integration not found");
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    if (parsed.data.instanceId) {
      const inst = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
      if (!inst) throw new NotFoundError("Instance not found");
    }
    const row = await db.inboundIntegration.update({ where: { id }, data: parsed.data as any });
    return NextResponse.json({ integration: { ...row, webhookUrl: `${baseUrl()}/integration_webhook/${row.token}` } });
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
    const existing = await db.inboundIntegration.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Integration not found");
    await db.inboundIntegration.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
