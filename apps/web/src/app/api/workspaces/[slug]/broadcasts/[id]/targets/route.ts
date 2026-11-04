import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

function toCsv(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "phone,name,status,error\n";
  const headers = Object.keys(rows[0]!);
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n") + "\n";
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "all";
  const q = url.searchParams.get("q") ?? "";
  const format = url.searchParams.get("format") ?? "json";

  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);

    const broadcast = await db.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundError("Broadcast not found");

    // Status → Prisma filter
    let statusFilter: object = {};
    if (statusParam === "not_sent") statusFilter = { status: { in: ["queued", "sending"] } };
    else if (statusParam === "failed") statusFilter = { status: "failed" };
    else if (statusParam === "sent") statusFilter = { status: { in: ["sent", "delivered", "read"] } };

    const where = {
      broadcastId: id,
      ...statusFilter,
      ...(q
        ? {
            contact: {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { phoneE164: { contains: q } },
              ],
            },
          }
        : {}),
    };

    // Instance label map
    const insts = await db.instance.findMany({ select: { id: true, label: true } });
    const labelById = new Map(insts.map((i) => [i.id, i.label]));

    if (format === "csv") {
      const rows2 = await db.broadcastTarget.findMany({
        where,
        include: { contact: { select: { name: true, phoneE164: true } } },
        orderBy: [{ status: "asc" }, { sentAt: "desc" }],
        take: 100000,
      });
      const csvRows = rows2.map((r) => ({
        phone: r.contact.phoneE164,
        name: r.contact.name ?? "",
        status: r.status,
        error: r.error ?? "",
      }));
      return new NextResponse(toCsv(csvRows), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="broadcast-${id}-${statusParam}.csv"`,
        },
      });
    }

    // JSON (default)
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const take = 50;
    const skip = (page - 1) * take;

    const [rows, total] = await Promise.all([
      db.broadcastTarget.findMany({
        where,
        include: { contact: { select: { name: true, phoneE164: true } } },
        orderBy: [{ status: "asc" }, { sentAt: "desc" }],
        take,
        skip,
      }),
      db.broadcastTarget.count({ where }),
    ]);

    // Per-number breakdown across the WHOLE broadcast (not just this page/filter)
    const grouped = await db.broadcastTarget.groupBy({
      by: ["instanceId", "status"],
      where: { broadcastId: id },
      _count: { _all: true },
    });

    const byInstanceMap = new Map<string, { instanceId: string; label: string; sent: number; failed: number }>();
    for (const g of grouped) {
      const key = g.instanceId ?? "unassigned";
      const existing = byInstanceMap.get(key);
      const row = existing ?? {
        instanceId: key,
        label: g.instanceId ? (labelById.get(g.instanceId) ?? g.instanceId) : "—",
        sent: 0,
        failed: 0,
      };
      if (["sent", "delivered", "read"].includes(g.status)) row.sent += g._count._all;
      if (g.status === "failed") row.failed += g._count._all;
      byInstanceMap.set(key, row);
    }

    const targets = rows.map((r) => ({
      id: r.id,
      name: r.contact.name ?? "",
      phone: r.contact.phoneE164,
      status: r.status,
      instanceLabel: r.instanceId ? (labelById.get(r.instanceId) ?? r.instanceId) : "",
      error: r.error ?? "",
      sentAt: r.sentAt?.toISOString() ?? null,
    }));

    return NextResponse.json({
      targets,
      total,
      page,
      byInstance: [...byInstanceMap.values()],
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
