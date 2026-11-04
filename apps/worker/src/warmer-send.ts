import type { Processor } from "bullmq";
import { prisma } from "@evo/db";
import { sendViaInstance } from "@evo/send";

export interface WarmerSendJob {
  runId: string;
  workspaceId: string;
  instanceId: string;
  to: string;
  text: string;
  typingDelayMs: number;
}

export const warmerSendProcessor: Processor<WarmerSendJob> = async (job) => {
  const { runId, workspaceId, instanceId, to, text } = job.data;
  try {
    await sendViaInstance(instanceId, { type: "text", to, text, userId: null }, { origin: "warmer" });
    await prisma.warmerEvent.create({
      data: { workspaceId, runId, instanceId, kind: "send", detail: { to, textPreview: text.slice(0, 80) } } as any,
    });
  } catch (err: any) {
    await prisma.warmerEvent.create({
      data: { workspaceId, runId, instanceId, kind: "error", detail: { message: String(err?.message ?? err).slice(0, 500) } } as any,
    });
  }
};
