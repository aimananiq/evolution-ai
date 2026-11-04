import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

const schema = z.object({
  scope: z.enum(["failed", "remaining"]),
  instanceId: z.string().optional(),
  instanceGroupId: z.string().optional().nullable(),
  groupSendMode: z.enum(["parallel", "rotate"]).optional(),
  rotateEvery: z.number().int().min(1).max(10000).optional(),
  intervalMinSec: z.number().int().min(0).max(3600).optional(),
  intervalMaxSec: z.number().int().min(0).max(7200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });

    const db = tenantClient(workspace.id);

    const broadcast = await db.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundError("Broadcast not found");

    // Resolve sender — mirrors the create route logic
    let primaryInstanceId = broadcast.instanceId;

    if (parsed.data.instanceGroupId) {
      const group = await db.instanceGroup.findUnique({
        where: { id: parsed.data.instanceGroupId },
        include: { members: { select: { instanceId: true } } },
      });
      if (!group) return NextResponse.json({ error: "GROUP_NOT_FOUND" }, { status: 400 });
      if (group.members.length === 0) return NextResponse.json({ error: "GROUP_EMPTY" }, { status: 400 });
      if (!parsed.data.groupSendMode) return NextResponse.json({ error: "GROUP_MODE_REQUIRED" }, { status: 400 });
      primaryInstanceId = group.members[0]!.instanceId;
    } else if (parsed.data.instanceId) {
      const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
      if (!instance) return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 400 });
      primaryInstanceId = parsed.data.instanceId;
    }
    // else: keep broadcast's current sender

    // Re-queue targets (never touch already-sent)
    const statusWhere =
      parsed.data.scope === "failed"
        ? { status: "failed" as const }
        : { status: { in: ["failed", "queued"] as ("failed" | "queued")[] } };

    const { count } = await db.broadcastTarget.updateMany({
      where: { broadcastId: id, ...statusWhere },
      data: { status: "queued", error: null, instanceId: null },
    });

    if (count === 0) return NextResponse.json({ ok: true, requeued: 0 });

    await db.broadcast.update({
      where: { id },
      data: {
        instanceId: primaryInstanceId,
        instanceGroupId: parsed.data.instanceGroupId ?? (parsed.data.instanceId ? null : broadcast.instanceGroupId),
        groupSendMode: parsed.data.instanceGroupId
          ? parsed.data.groupSendMode
          : parsed.data.instanceId
          ? null
          : broadcast.groupSendMode,
        rotateEvery:
          parsed.data.instanceGroupId && parsed.data.groupSendMode === "rotate"
            ? (parsed.data.rotateEvery ?? 20)
            : broadcast.rotateEvery,
        fallbackInstanceIds: parsed.data.instanceGroupId ? [] : broadcast.fallbackInstanceIds,
        ...(parsed.data.intervalMinSec !== undefined ? { intervalMinSec: parsed.data.intervalMinSec } : {}),
        ...(parsed.data.intervalMaxSec !== undefined ? { intervalMaxSec: parsed.data.intervalMaxSec } : {}),
        nextSlotAt: null,
        groupState: null,
        status: "running",
        completedAt: null,
      } as any,
    });

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "broadcast.retried",
      target: `broadcast:${id}`,
      diff: { scope: parsed.data.scope, requeued: count },
    });

    return NextResponse.json({ ok: true, requeued: count });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
