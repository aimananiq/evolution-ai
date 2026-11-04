import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional().nullable(),
  labelIds: z.array(z.string()).optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Contact not found");

    if (parsed.data.labelIds !== undefined) {
      await db.contactLabel.deleteMany({ where: { contactId: id } } as any);
      if (parsed.data.labelIds.length) {
        await db.contactLabel.createMany({
          data: parsed.data.labelIds.map((labelId) => ({ contactId: id, labelId })),
        } as any);
      }
    }
    const contact = await db.contact.update({
      where: { id },
      data: { name: parsed.data.name ?? undefined },
    });
    return NextResponse.json({ contact });
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
    const existing = await db.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Contact not found");
    await db.contact.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
