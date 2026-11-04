import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

const BATCH_SIZE = 200;

export async function runDripTick(opts?: { now?: Date }): Promise<{ advanced: number }> {
  const now = opts?.now ?? new Date();
  const due = await prisma.dripEnrolment.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: now },
      campaign: { name: { not: { startsWith: "__followup__" } } },
    },
    include: {
      campaign: { include: { instance: true } },
      contact: true,
    },
    take: BATCH_SIZE,
  });
  let advanced = 0;
  for (const e of due) {
    const steps = e.campaign.steps as Array<{ templateId: string; delayMs: number }>;
    if (e.currentStep >= steps.length) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "completed", completedAt: now },
      });
      continue;
    }
    const step = steps[e.currentStep]!;
    const template = await prisma.messageTemplate.findUnique({ where: { id: step.templateId } });
    if (!template) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "failed" },
      });
      continue;
    }
    try {
      await sendViaInstance(e.campaign.instanceId, {
        type: "text",
        to: e.contact.phoneE164,
        text: template.body,
        userId: null,
      }, { origin: "drip" });
    } catch {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { status: "failed" },
      });
      continue;
    }

    const nextIndex = e.currentStep + 1;
    if (nextIndex >= steps.length) {
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, status: "completed", completedAt: now },
      });
    } else {
      const nextDelay = steps[nextIndex]?.delayMs ?? 0;
      await prisma.dripEnrolment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, nextRunAt: new Date(now.getTime() + nextDelay) },
      });
    }
    advanced += 1;
  }
  return { advanced };
}
