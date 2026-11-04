import { NextResponse } from "next/server";
import { tenantClient, prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);

    if ("botUserLog" in (prisma as any)) {
      // Funnel version: group BotUserLog by contactId.
      const rows = await (db as any).botUserLog.groupBy({
        by: ["contactId"],
        _count: { _all: true },
        _max: { createdAt: true },
        _min: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: 500,
      });
      // Hydrate contact phone for each contactId
      const contactIds: string[] = rows.map((r: any) => r.contactId).filter(Boolean);
      const contacts = contactIds.length
        ? await db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, phoneE164: true, name: true } })
        : [];
      const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
      const leads = rows.map((r: any) => ({
        contactId: r.contactId,
        phone: contactMap[r.contactId]?.phoneE164 ?? r.contactId ?? "—",
        name: contactMap[r.contactId]?.name ?? null,
        interactions: r._count._all,
        firstSeen: r._min.createdAt,
        lastSeen: r._max.createdAt,
      }));
      return NextResponse.json({ leads, mode: "funnel" });
    }

    // Degraded version: conversations as leads.
    const convos = await db.conversation.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: 500,
      select: { contactPhone: true, contactName: true, lastMessageAt: true, unreadCount: true, status: true },
    });
    return NextResponse.json({ leads: convos, mode: "degraded" });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
