import { prisma } from "@evo/db";
import { redis, tokenBucket } from "@evo/queue";
import { EvolutionClient, MessageApi } from "@evo/evolution-client";
import { revealSecret } from "@evo/crypto";
import { rampCapForDay, daysSince, bulkSendKey } from "@evo/health";

const DEFAULT_BUCKET = { capacity: 10, refillPerSecond: 0.5 };
const WAIT_MS = 5 * 60 * 1000;
const COUNTER_TTL_SEC = 48 * 3600;

export type SendOrigin =
  | "broadcast" | "drip" | "inbound" | "followup"
  | "manual" | "chatbot" | "autoresponder" | "warmer";

const BULK_ORIGINS = new Set<SendOrigin>(["broadcast", "drip", "inbound", "followup"]);

export interface SendOptions {
  origin?: SendOrigin;
}

export class RampCapError extends Error {
  constructor(public instanceId: string, public cap: number) {
    super(`ramp cap reached for instance ${instanceId} (cap ${cap})`);
    this.name = "RampCapError";
  }
}

export interface SendTextPayload {
  type: "text";
  to: string;
  text: string;
  userId: string | null;
}

export interface SendMediaPayload {
  type: "media";
  to: string;
  mediaUrl: string;
  mediatype: "image" | "document" | "video" | "audio";
  mimetype?: string;
  caption?: string;
  fileName?: string;
  userId: string | null;
}

export type SendPayload = SendTextPayload | SendMediaPayload;

export { mediaPayloadFromAsset } from "./media";

/** Returns remaining bulk allowance today for an instance, or null if unlimited (ramp off). */
export async function remainingBulkToday(instanceId: string, now = new Date()): Promise<number | null> {
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (!policy || !policy.rampEnabled || !policy.rampStartedAt) return null;
  const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
  try {
    const used = Number((await redis().get(bulkSendKey(instanceId, now))) ?? 0);
    return Math.max(0, cap - used);
  } catch {
    return null; // fail open
  }
}

async function enforceAndCountBulk(instanceId: string, now: Date): Promise<void> {
  const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId } });
  if (!policy || !policy.rampEnabled || !policy.rampStartedAt) {
    // Ramp off: still count usage for the capUsage metric, but never block.
    try {
      const key = bulkSendKey(instanceId, now);
      await redis().incr(key);
      await redis().expire(key, COUNTER_TTL_SEC);
    } catch { /* fail open */ }
    return;
  }
  const cap = rampCapForDay(policy, daysSince(policy.rampStartedAt, now));
  const key = bulkSendKey(instanceId, now);
  try {
    const used = Number((await redis().get(key)) ?? 0);
    if (used >= cap) throw new RampCapError(instanceId, cap);
    await redis().incr(key);
    await redis().expire(key, COUNTER_TTL_SEC);
  } catch (e) {
    if (e instanceof RampCapError) throw e;
    // redis failure -> fail open, do not block sends
  }
}

export async function sendViaInstance(
  instanceId: string,
  payload: SendPayload,
  opts: SendOptions = {},
) {
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (!instance) throw new Error(`instance not found: ${instanceId}`);

  const origin = opts.origin ?? "manual";
  if (BULK_ORIGINS.has(origin)) {
    await enforceAndCountBulk(instanceId, new Date());
  }

  const bucket = tokenBucket(instanceId, DEFAULT_BUCKET);
  const taken = await bucket.take({ waitMs: WAIT_MS });
  if (!taken.granted) {
    throw new Error(`throttled: bucket empty for instance ${instanceId} after ${taken.waitedMs}ms`);
  }

  const base = process.env.EVOLUTION_BASE_URL;
  if (!base) throw new Error("EVOLUTION_BASE_URL not set");
  const client = new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) });
  const api = new MessageApi(client);

  try {
    await api.sendPresence(instance.evolutionInstanceName, payload.to, "composing");
  } catch {}

  try {
    if (payload.type === "text") {
      return await api.sendText(instance.evolutionInstanceName, { number: payload.to, text: payload.text });
    }
    return await api.sendMedia(instance.evolutionInstanceName, {
      number: payload.to,
      mediatype: payload.mediatype,
      media: payload.mediaUrl,
      mimetype: payload.mimetype,
      caption: payload.caption,
      fileName: payload.fileName,
    });
  } catch (err: any) {
    // A dead/half-open WhatsApp session throws these on every send (Evolution 500 /
    // "Connection Closed"). Count them so the canary tick can flag send_failing.
    const msg = String(err?.message ?? err);
    if (/\b500\b|connection closed|precondition required/i.test(msg)) {
      await prisma.instance.update({ where: { id: instanceId }, data: { sendFailStreak: { increment: 1 } } }).catch(() => {});
    }
    throw err;
  }
}
