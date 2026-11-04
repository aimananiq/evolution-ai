import { sendViaInstance, mediaPayloadFromAsset } from "@evo/send";
import { redis } from "@evo/queue";
import { isWithinSchedule, type ScheduleConfig } from "@evo/schedule";

export interface AutoresponderInput {
  workspaceId: string;
  instanceId: string;
  contactPhone: string;
  inboundText: string;
  isGroup: boolean;
}

export async function runAutoresponder(input: AutoresponderInput, now: Date = new Date()): Promise<boolean> {
  const { prisma } = await import("@evo/db");
  const cfg = await prisma.autoresponder.findUnique({ where: { instanceId: input.instanceId } });
  if (!cfg || !cfg.enabled) return false;

  // Scope gate.
  if (cfg.sendTo === "individual" && input.isGroup) return false;
  if (cfg.sendTo === "group" && !input.isGroup) return false;

  // Schedule gate.
  if (!isWithinSchedule((cfg.scheduleJson as ScheduleConfig | null) ?? null, now)) return false;

  // Pause gate (fail-open if Redis errors).
  const pauseKey = `autoresp:pause:${input.instanceId}:${input.contactPhone}`;
  if (cfg.pausePerCustomerSec > 0) {
    try {
      const r = redis();
      const paused = await r.get(pauseKey);
      if (paused) return false;
    } catch {
      // fail-open: Redis unavailable → don't block sending
    }
  }

  // Exclude-list gate.
  if (cfg.excludeContactListIds.length) {
    const inExcluded = await prisma.contactListMember.count({
      where: {
        listId: { in: cfg.excludeContactListIds },
        contact: { workspaceId: input.workspaceId, phoneE164: input.contactPhone },
      },
    });
    if (inExcluded > 0) return false;
  }

  const text = cfg.text?.trim();
  // Media reply (Plan 7): caption prefers the dedicated caption field, else the text.
  const mediaPayload = cfg.mediaAssetId
    ? await mediaPayloadFromAsset(cfg.mediaAssetId, input.workspaceId, input.contactPhone, cfg.caption?.trim() || text || undefined)
    : null;
  if (!mediaPayload && !text) return false; // nothing configured (or asset deleted with no text fallback)

  await sendViaInstance(
    input.instanceId,
    mediaPayload ?? { type: "text", to: input.contactPhone, text: text!, userId: null },
    { origin: "autoresponder" },
  );

  if (cfg.pausePerCustomerSec > 0) {
    try {
      const r = redis();
      await r.set(pauseKey, "1", "EX", cfg.pausePerCustomerSec);
    } catch {
      // fail-open: don't break on Redis error
    }
  }

  return true;
}
