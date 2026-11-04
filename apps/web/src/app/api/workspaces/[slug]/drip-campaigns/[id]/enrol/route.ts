import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  contactIds: z.array(z.string()).optional(),
  listId: z.string().optional(),
}).refine((d) => (d.contactIds && d.contactIds.length) || d.listId, { message: "either contactIds or listId required" });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const campaign = await db.dripCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundError("Campaign not found");

    let contactIds = parsed.data.contactIds ?? [];
    if (parsed.data.listId) {
      // ContactListMember has no workspaceId and is not tenant-scoped, so verify the
      // list belongs to this workspace via the scoped client before reading members
      // (prevents cross-tenant enrolment / list-membership disclosure).
      const list = await db.contactList.findUnique({ where: { id: parsed.data.listId } });
      if (!list) throw new NotFoundError("List not found");
      const members = await db.contactListMember.findMany({
        where: { listId: parsed.data.listId },
        select: { contactId: true },
      } as any);
      contactIds = members.map((m: any) => m.contactId);
    }
    if (!contactIds.length) {
      return NextResponse.json({ error: "NO_CONTACTS" }, { status: 400 });
    }

    const steps = campaign.steps as Array<{ templateId: string; delayMs: number }>;
    const firstDelay = steps[0]?.delayMs ?? 0;
    const nextRunAt = new Date(Date.now() + firstDelay);

    await db.dripEnrolment.createMany({
      data: contactIds.map((contactId) => ({
        campaignId: id,
        contactId,
        currentStep: 0,
        nextRunAt,
      })),
      skipDuplicates: true,
    } as any);

    return NextResponse.json({ ok: true, enrolled: contactIds.length });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
