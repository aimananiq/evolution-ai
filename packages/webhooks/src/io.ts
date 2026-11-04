import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { prisma } from "@evo/db";
import { redis } from "@evo/queue";
import { assertPublicUrl, ssrfAllowHosts } from "@evo/shared/ssrf";
import {
  WEBHOOK_FANOUT_QUEUE,
  WEBHOOK_DELIVER_QUEUE,
  matchingSubs,
  buildDelivery,
  deliveryHeaders,
} from "./core";

export interface FanoutJob {
  workspaceId: string;
  event: string;
  data: Record<string, unknown>;
  at: string;
}

export interface DeliverJob {
  workspaceId: string;
  subscriptionId: string;
  url: string;
  secret: string;
  event: string;
  body: string;
  at: string;
}

let _fanoutQueue: Queue<FanoutJob> | null = null;
let _deliverQueue: Queue<DeliverJob> | null = null;

function fanoutQueue(): Queue<FanoutJob> {
  if (!_fanoutQueue) _fanoutQueue = new Queue<FanoutJob>(WEBHOOK_FANOUT_QUEUE, { connection: redis() as any });
  return _fanoutQueue;
}
function deliverQueue(): Queue<DeliverJob> {
  if (!_deliverQueue) _deliverQueue = new Queue<DeliverJob>(WEBHOOK_DELIVER_QUEUE, { connection: redis() as any });
  return _deliverQueue;
}

/**
 * Fire-and-forget: enqueue a webhook event for fan-out to subscriptions.
 * Best-effort — enqueue failures are swallowed so the caller's action is never blocked.
 */
export async function emitWebhook(
  workspaceId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await fanoutQueue().add(
      "fanout",
      { workspaceId, event, data, at: new Date().toISOString() },
      { removeOnComplete: 1000, removeOnFail: 1000 },
    );
  } catch {
    /* redis unavailable — drop the event rather than block the caller */
  }
}

/** Fanout processor: load matching subscriptions and enqueue one delivery each. */
export async function runWebhookFanout(job: { data: FanoutJob }): Promise<{ enqueued: number }> {
  const { workspaceId, event, data, at } = job.data;
  const subs = await prisma.webhookSubscription.findMany({ where: { workspaceId, enabled: true } });
  const targets = matchingSubs(subs, event);
  if (targets.length === 0) return { enqueued: 0 };

  const { body } = buildDelivery(event, data, at);
  for (const sub of targets) {
    await deliverQueue().add(
      "deliver",
      { workspaceId, subscriptionId: sub.id, url: sub.url, secret: sub.secret, event, body, at },
      { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 2000, removeOnFail: 2000 },
    );
  }
  return { enqueued: targets.length };
}

/** Delivery processor: POST the signed body; log the attempt; throw on failure to retry. */
export async function deliverWebhook(job: { data: DeliverJob }): Promise<void> {
  const { workspaceId, subscriptionId, url, secret, event, body, at } = job.data;
  const deliveryId = randomUUID();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;

  // SSRF guard: re-check at delivery time (defends against DNS rebinding after the
  // subscription was created). A blocked URL is logged and NOT retried.
  const safe = await assertPublicUrl(url, ssrfAllowHosts());
  if (!safe.ok) {
    try {
      await prisma.webhookDeliveryLog.create({
        data: { workspaceId, subscriptionId, event, url, ok: false, error: `blocked: ${safe.reason}` },
      });
    } catch {
      /* logging is best-effort */
    }
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: deliveryHeaders(body, secret, event, deliveryId, at),
      body,
    });
    statusCode = res.status;
    ok = res.ok;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 500);
  }

  try {
    await prisma.webhookDeliveryLog.create({
      data: { workspaceId, subscriptionId, event, url, ok, statusCode: statusCode ?? undefined, error: error ?? undefined },
    });
  } catch {
    /* logging is best-effort */
  }

  if (!ok) throw new Error(error ?? "webhook delivery failed");
}
