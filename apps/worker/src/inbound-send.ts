import type { Processor } from "bullmq";
import { prisma } from "@evo/db";
import { sendViaInstance, mediaPayloadFromAsset } from "@evo/send";

export interface InboundSendJob {
  integrationId: string;
  instanceId: string;
  to: string;
  text: string;
  logId: string;
  workspaceId?: string;
  mediaAssetId?: string | null;
}

export const inboundSendProcessor: Processor<InboundSendJob> = async (job) => {
  const { instanceId, to, text, logId, workspaceId, mediaAssetId } = job.data;
  try {
    // Integration media (Plan 7): send the asset with the rendered text as caption; text fallback.
    const mediaPayload = mediaAssetId && workspaceId
      ? await mediaPayloadFromAsset(mediaAssetId, workspaceId, to, text)
      : null;
    await sendViaInstance(
      instanceId,
      mediaPayload ?? { type: "text", to, text, userId: null },
      { origin: "inbound" },
    );
    await prisma.inboundIntegrationLog.update({ where: { id: logId }, data: { status: "sent" } });
  } catch (err: any) {
    await prisma.inboundIntegrationLog.update({
      where: { id: logId },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
    throw err; // let BullMQ retry per the job's attempts/backoff
  }
};
