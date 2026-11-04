import { hmacSha256Hex } from "@evo/crypto";

export const WEBHOOK_FANOUT_QUEUE = "webhook-fanout";
export const WEBHOOK_DELIVER_QUEUE = "webhook-deliver";

export interface SubscriptionRow {
  id: string;
  url: string;
  secret: string;
  events: unknown;
  enabled: boolean;
}

export interface DeliveryEnvelope {
  event: string;
  at: string;
  data: Record<string, unknown>;
}

/** Enabled subscriptions whose event list includes `event`. */
export function matchingSubs<T extends { events: unknown; enabled: boolean }>(
  subs: T[],
  event: string,
): T[] {
  return subs.filter((s) => {
    if (!s.enabled) return false;
    const list = Array.isArray(s.events) ? (s.events as unknown[]) : [];
    return list.includes(event);
  });
}

/** Builds the delivery envelope and its serialized body. */
export function buildDelivery(
  event: string,
  data: Record<string, unknown>,
  nowIso: string,
): { envelope: DeliveryEnvelope; body: string } {
  const envelope: DeliveryEnvelope = { event, at: nowIso, data };
  return { envelope, body: JSON.stringify(envelope) };
}

/** Headers a consumer (n8n, Zapier, …) uses to verify authenticity. */
export function deliveryHeaders(
  body: string,
  secret: string,
  event: string,
  deliveryId: string,
  nowIso: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-webhook-event": event,
    "x-webhook-id": deliveryId,
    "x-webhook-timestamp": nowIso,
    "x-webhook-signature": `sha256=${hmacSha256Hex(body, secret)}`,
  };
}
