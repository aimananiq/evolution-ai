import { prisma } from "@evo/db";
import { Queue } from "bullmq";
import { redis, tokenBucket } from "@evo/queue";
import { getByPath, renderTemplate, normalisePhone } from "@evo/inbound-templating";

export const INBOUND_SEND_QUEUE = "inbound-send";

export interface InboundSendJob {
  integrationId: string;
  instanceId: string;
  to: string;
  text: string;
  logId: string;
  workspaceId?: string;
  mediaAssetId?: string | null;
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

// Lazily-created queue (shares the ingest Redis connection).
let _queue: Queue<InboundSendJob> | null = null;
function sendQueue(): Queue<InboundSendJob> {
  if (!_queue) _queue = new Queue<InboundSendJob>(INBOUND_SEND_QUEUE, { connection: redis() as any });
  return _queue;
}

const RATE = { capacity: 30, refillPerSecond: 1 };

/**
 * Core receiver logic. `payload` is the already-parsed JSON body.
 * Returns the HTTP status + JSON body to send back.
 */
export async function handleInbound(token: string, payload: unknown): Promise<InboundResult> {
  const integration = await prisma.inboundIntegration.findUnique({ where: { token } });
  if (!integration) return { status: 404, body: { error: "NOT_FOUND" } };

  // Per-token rate limit (best-effort; never blocks indefinitely).
  const bucket = tokenBucket(`inbound:${integration.id}`, RATE);
  const taken = await bucket.take({ waitMs: 0 });
  if (!taken.granted) return { status: 429, body: { error: "RATE_LIMITED" } };

  // ALWAYS record the sample so Capture Response works, even when disabled.
  await prisma.inboundIntegration.update({
    where: { id: integration.id },
    data: { lastReceivedAt: new Date(), lastSamplePayload: payload as any },
  });

  if (!integration.enabled) {
    // Acknowledge but do nothing (and do not write a delivery log).
    return { status: 200, body: { ok: true, skipped: "disabled" } };
  }

  const rawPhone = getByPath(payload, integration.recipientPathKey);
  const to = normalisePhone(rawPhone);

  if (!to) {
    await prisma.inboundIntegrationLog.create({
      data: {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        payload: payload as any,
        resolvedPhone: null,
        status: "no_recipient",
        error: `no recipient at path "${integration.recipientPathKey}"`,
      },
    });
    return { status: 422, body: { error: "NO_RECIPIENT" } };
  }

  const text = renderTemplate(integration.captionTemplate, payload);
  const log = await prisma.inboundIntegrationLog.create({
    data: {
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
      payload: payload as any,
      resolvedPhone: to,
      status: "received",
    },
  });

  try {
    await sendQueue().add(
      "send",
      { integrationId: integration.id, instanceId: integration.instanceId, to, text, logId: log.id, workspaceId: integration.workspaceId, mediaAssetId: integration.mediaAssetId ?? null },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: 100 },
    );
  } catch (err: any) {
    await prisma.inboundIntegrationLog.update({
      where: { id: log.id },
      data: { status: "failed", error: String(err?.message ?? err).slice(0, 500) },
    });
    return { status: 200, body: { ok: true, queued: false } };
  }

  return { status: 200, body: { ok: true, queued: true } };
}
