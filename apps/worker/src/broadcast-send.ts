import type { Processor } from "bullmq";
import { prisma } from "@evo/db";
import { sendViaInstance, mediaPayloadFromAsset, RampCapError } from "@evo/send";

export interface BroadcastSendJob {
  broadcastId: string;
  targetId: string;
  instanceId: string;
  to: string;
  text: string;
  mediaAssetId?: string | null;
  workspaceId?: string;
}

export const broadcastSendProcessor: Processor<BroadcastSendJob> = async (job) => {
  const { targetId, instanceId, to, text, mediaAssetId, workspaceId } = job.data;
  try {
    // Optional broadcast media (Feature C): send the asset with the personalized text as caption; text fallback.
    const mediaPayload = mediaAssetId && workspaceId
      ? await mediaPayloadFromAsset(mediaAssetId, workspaceId, to, text)
      : null;
    // If media was requested but the asset is gone (deleted after the job was queued),
    // we fall back to text — warn so a silently text-only run is observable.
    if (mediaAssetId && workspaceId && !mediaPayload) {
      console.warn(`broadcast ${job.data.broadcastId}: media asset ${mediaAssetId} unavailable — sent as text`);
    }
    const result = await sendViaInstance(instanceId, mediaPayload ?? { type: "text", to, text, userId: null }, { origin: "broadcast" });
    // Guard on status:"sending" so a stale job (e.g. one left on a number that got
    // failed-over away) can't overwrite a terminal result written by the job that
    // re-sent this target on the backup number. First job to finish wins.
    await prisma.broadcastTarget.updateMany({
      where: { id: targetId, status: "sending" },
      data: { status: "sent", sentAt: new Date(), evolutionMessageId: result?.key?.id },
    });
  } catch (err: any) {
    if (err instanceof RampCapError) {
      await prisma.broadcastTarget.updateMany({ where: { id: targetId, status: "sending" }, data: { status: "queued" } });
      return;
    }
    await prisma.broadcastTarget.updateMany({
      where: { id: targetId, status: "sending" },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
  }
};
