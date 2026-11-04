import { prisma } from "@evo/db";
import { sendViaInstance, mediaPayloadFromAsset } from "@evo/send";

const BATCH_SIZE = 200;
const PREFIX = "__followup__";

interface FollowUpStep { text: string; delaySeconds: number; mediaAssetId?: string | null }

export async function runFollowUpTick(opts?: { now?: Date }): Promise<{ sent: number }> {
  const now = opts?.now ?? new Date();
  const due = await prisma.dripEnrolment.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: now },
      campaign: { name: { startsWith: PREFIX } },
    },
    include: { campaign: true, contact: true },
    take: BATCH_SIZE,
  });

  let sent = 0;
  for (const e of due) {
    const steps = (e.campaign.steps as unknown as FollowUpStep[]) ?? [];
    if (e.currentStep >= steps.length) {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { status: "completed", completedAt: now } });
      continue;
    }
    const step = steps[e.currentStep]!;
    try {
      // Step media (Plan 7): send the asset with the step text as caption; text fallback.
      const mediaPayload = step.mediaAssetId
        ? await mediaPayloadFromAsset(step.mediaAssetId, e.workspaceId, e.contact.phoneE164, step.text)
        : null;
      await sendViaInstance(
        e.campaign.instanceId,
        mediaPayload ?? { type: "text", to: e.contact.phoneE164, text: step.text, userId: null },
        { origin: "followup" },
      );
    } catch {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { status: "failed" } });
      continue;
    }
    await prisma.botUserLog.create({
      data: {
        workspaceId: e.workspaceId, instanceId: e.campaign.instanceId,
        contactId: e.contactId, kind: "follow_up_sent",
        detail: { step: e.currentStep, text: step.text } as any,
      },
    });

    const nextIndex = e.currentStep + 1;
    if (nextIndex >= steps.length) {
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { currentStep: nextIndex, status: "completed", completedAt: now } });
    } else {
      const nextDelayMs = (steps[nextIndex]?.delaySeconds ?? 0) * 1000;
      await prisma.dripEnrolment.update({ where: { id: e.id }, data: { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + nextDelayMs) } });
    }
    sent += 1;
  }
  return { sent };
}
