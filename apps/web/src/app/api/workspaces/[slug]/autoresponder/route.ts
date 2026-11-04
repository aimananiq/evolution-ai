import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { EvolutionClient, SettingsApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@evo/shared";

const scheduleSchema = z.object({
  parts: z.array(z.enum(["daytime", "nighttime", "odd", "even"])).default([]),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
}).nullable().optional();

const putSchema = z.object({
  instanceId: z.string(),
  enabled: z.boolean(),
  sendTo: z.enum(["all", "individual", "group"]),
  text: z.string().max(4000).nullable().optional(),
  mediaAssetId: z.string().nullable().optional(),
  caption: z.string().max(1000).nullable().optional(),
  rejectCall: z.boolean(),
  msgCall: z.string().max(1000).nullable().optional(),
  pausePerCustomerSec: z.number().int().min(0).max(86400),
  scheduleJson: scheduleSchema,
  excludeContactListIds: z.array(z.string()).default([]),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instanceId = new URL(req.url).searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const autoresponder = await db.autoresponder.findUnique({ where: { instanceId } });
    return NextResponse.json({ autoresponder });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const d = parsed.data;

    const db = tenantClient(workspace.id);
    const instance = await db.instance.findUnique({ where: { id: d.instanceId } });
    if (!instance) throw new NotFoundError("Instance not found");

    const autoresponder = await db.autoresponder.upsert({
      where: { instanceId: d.instanceId },
      create: {
        workspaceId: workspace.id,
        instanceId: d.instanceId,
        enabled: d.enabled,
        sendTo: d.sendTo,
        text: d.text ?? null,
        mediaAssetId: d.mediaAssetId ?? null,
        caption: d.caption ?? null,
        rejectCall: d.rejectCall,
        msgCall: d.msgCall ?? null,
        pausePerCustomerSec: d.pausePerCustomerSec,
        scheduleJson: (d.scheduleJson ?? undefined) as any,
        excludeContactListIds: d.excludeContactListIds,
      },
      update: {
        enabled: d.enabled,
        sendTo: d.sendTo,
        text: d.text ?? null,
        mediaAssetId: d.mediaAssetId ?? null,
        caption: d.caption ?? null,
        rejectCall: d.rejectCall,
        msgCall: d.msgCall ?? null,
        pausePerCustomerSec: d.pausePerCustomerSec,
        scheduleJson: (d.scheduleJson ?? undefined) as any,
        excludeContactListIds: d.excludeContactListIds,
      },
    });

    // Push reject-call settings to Evolution (best-effort; don't fail the save if Evolution is down).
    const base = process.env.EVOLUTION_BASE_URL;
    if (base) {
      try {
        const settings = new SettingsApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
        await settings.setSettings(instance.evolutionInstanceName, {
          rejectCall: d.rejectCall,
          ...(d.msgCall ? { msgCall: d.msgCall } : {}),
        });
      } catch { /* surfaced via audit only */ }
    }

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      instanceId: d.instanceId,
      action: "autoresponder.saved",
      target: `instance:${d.instanceId}`,
      diff: { enabled: d.enabled, rejectCall: d.rejectCall, sendTo: d.sendTo },
    });

    return NextResponse.json({ autoresponder });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
