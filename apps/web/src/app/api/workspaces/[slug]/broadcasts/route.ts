import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  instanceId: z.string(),
  listId: z.string(),
  templateId: z.string().optional(),
  mediaAssetId: z.string().optional().nullable(),
  scheduledAt: z.string().datetime().optional(),
  jitterMinMs: z.number().int().min(0).max(60000).optional(),
  jitterMaxMs: z.number().int().min(0).max(120000).optional(),
  intervalMinSec: z.number().int().min(0).max(3600).optional(),
  intervalMaxSec: z.number().int().min(0).max(7200).optional(),
  scheduleJson: z.object({
    parts: z.array(z.enum(["daytime", "nighttime", "odd", "even"])).default([]),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  }).nullable().optional(),
  excludeContactListIds: z.array(z.string()).default([]),
  fallbackInstanceIds: z.array(z.string()).default([]),
  instanceGroupId: z.string().optional().nullable(),
  groupSendMode: z.enum(["parallel", "rotate"]).optional(),
  rotateEvery: z.number().int().min(1).max(10000).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const broadcasts = await db.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { list: { select: { name: true } }, template: { select: { name: true } }, _count: { select: { targets: true } } },
    });
    return NextResponse.json({ broadcasts });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.jitterMinMs !== undefined && parsed.data.jitterMaxMs !== undefined && parsed.data.jitterMinMs > parsed.data.jitterMaxMs) {
      return NextResponse.json({ error: "JITTER_INVALID" }, { status: 400 });
    }
    if (parsed.data.intervalMinSec !== undefined && parsed.data.intervalMaxSec !== undefined && parsed.data.intervalMinSec > parsed.data.intervalMaxSec) {
      return NextResponse.json({ error: "INTERVAL_INVALID" }, { status: 400 });
    }

    const db = tenantClient(workspace.id);

    const list = await db.contactList.findUnique({
      where: { id: parsed.data.listId },
      include: { members: { include: { contact: true } } },
    });
    if (!list) throw new NotFoundError("List not found");
    const instance = await db.instance.findUnique({ where: { id: parsed.data.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");

    // Group mode: verify the group belongs to this workspace and has ≥1 member.
    // instanceId stays required (a valid FK for display) — set it to the first member.
    let primaryInstanceId = parsed.data.instanceId;
    if (parsed.data.instanceGroupId) {
      const group = await db.instanceGroup.findUnique({
        where: { id: parsed.data.instanceGroupId },
        include: { members: { select: { instanceId: true } } },
      });
      if (!group) return NextResponse.json({ error: "GROUP_NOT_FOUND" }, { status: 400 });
      if (group.members.length === 0) return NextResponse.json({ error: "GROUP_EMPTY" }, { status: 400 });
      if (!parsed.data.groupSendMode) return NextResponse.json({ error: "GROUP_MODE_REQUIRED" }, { status: 400 });
      primaryInstanceId = group.members[0]!.instanceId;
    }

    // Verify all fallback (backup) instances belong to this workspace.
    if (parsed.data.fallbackInstanceIds.length) {
      const fb = await db.instance.findMany({ where: { id: { in: parsed.data.fallbackInstanceIds } }, select: { id: true } });
      if (fb.length !== parsed.data.fallbackInstanceIds.length) {
        return NextResponse.json({ error: "INSTANCE_NOT_FOUND" }, { status: 400 });
      }
    }
    // Verify the media asset belongs to this workspace (tenantClient scopes the lookup).
    if (parsed.data.mediaAssetId) {
      const asset = await db.mediaAsset.findUnique({ where: { id: parsed.data.mediaAssetId } });
      if (!asset) throw new NotFoundError("Media asset not found");
    }

    // Build excluded contact set
    let excludedContactIds = new Set<string>();
    if (parsed.data.excludeContactListIds.length) {
      const ex = await db.contactListMember.findMany({
        where: { listId: { in: parsed.data.excludeContactListIds } },
        select: { contactId: true },
      });
      excludedContactIds = new Set(ex.map((m) => m.contactId));
    }
    const targetMembers = list.members.filter((m) => !excludedContactIds.has(m.contactId));

    const initialStatus = parsed.data.scheduledAt ? "scheduled" : "draft";

    const broadcast = await db.broadcast.create({
      data: {
        instanceId: primaryInstanceId,
        listId: parsed.data.listId,
        templateId: parsed.data.templateId,
        mediaAssetId: parsed.data.mediaAssetId ?? null,
        name: parsed.data.name,
        status: initialStatus,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
        jitterMinMs: parsed.data.jitterMinMs ?? 2000,
        jitterMaxMs: parsed.data.jitterMaxMs ?? 8000,
        intervalMinSec: parsed.data.intervalMinSec ?? null,
        intervalMaxSec: parsed.data.intervalMaxSec ?? null,
        scheduleJson: parsed.data.scheduleJson ?? null,
        excludeContactListIds: parsed.data.excludeContactListIds,
        fallbackInstanceIds: parsed.data.instanceGroupId ? [] : parsed.data.fallbackInstanceIds,
        instanceGroupId: parsed.data.instanceGroupId ?? null,
        groupSendMode: parsed.data.instanceGroupId ? parsed.data.groupSendMode : null,
        rotateEvery: parsed.data.instanceGroupId && parsed.data.groupSendMode === "rotate" ? (parsed.data.rotateEvery ?? 20) : null,
        createdByUserId: userId,
      } as any,
    });

    if (targetMembers.length) {
      await db.broadcastTarget.createMany({
        data: targetMembers.map((m) => ({
          broadcastId: broadcast.id,
          contactId: m.contactId,
          status: "queued",
        })),
        skipDuplicates: true,
      } as any);
    }

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "broadcast.created",
      target: `broadcast:${broadcast.id}`,
      diff: { name: parsed.data.name, listId: parsed.data.listId, targetCount: targetMembers.length },
    });

    return NextResponse.json({ broadcast }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
