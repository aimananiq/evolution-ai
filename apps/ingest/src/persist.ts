import type { NormalisedEvent } from "./normalise.js";
import { emitWebhook } from "@evo/webhooks";

export interface PersistContext {
  workspaceId: string;
  instanceId: string;
}

export async function persistEvent(
  ctx: PersistContext,
  evt: NormalisedEvent
): Promise<{ conversation?: any; message?: any }> {
  const { prisma } = await import("@evo/db");

  if (evt.kind === "connection") {
    await prisma.instance.update({
      where: { id: ctx.instanceId },
      data: {
        connectionState: evt.state,
        lastSeenAt: evt.state === "open" ? new Date() : undefined,
        ...(evt.state === "open" ? { sendFailStreak: 0, deliveryStatus: "unknown", deliveryMissStreak: 0 } : {}),
      },
    });
    void emitWebhook(ctx.workspaceId, "instance.state", { instanceId: ctx.instanceId, state: evt.state });
    return {};
  }

  if (evt.kind === "message-status") {
    const status = mapStatus(evt.status);
    await prisma.message.updateMany({
      where: { evolutionMessageId: evt.evolutionMessageId, workspaceId: ctx.workspaceId },
      data: { status },
    });
    void emitWebhook(ctx.workspaceId, "message.status", { instanceId: ctx.instanceId, evolutionMessageId: evt.evolutionMessageId, status });
    return {};
  }

  if (evt.kind === "message") {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({
        where: { evolutionMessageId: evt.evolutionMessageId },
      });
      if (existing) {
        return { message: existing };
      }
      const conversation = await tx.conversation.upsert({
        where: { instanceId_contactPhone: { instanceId: ctx.instanceId, contactPhone: evt.contactPhone } },
        create: {
          workspaceId: ctx.workspaceId,
          instanceId: ctx.instanceId,
          contactPhone: evt.contactPhone,
          contactLid: evt.contactLid,
          contactPhoneReal: evt.contactPhoneReal,
          contactName: evt.contactName,
          lastMessageAt: new Date(evt.sentAt),
          unreadCount: evt.direction === "inbound" ? 1 : 0,
        },
        update: {
          contactName: evt.contactName ?? undefined,
          // Only fill LID/real-phone when we have them — never overwrite with null.
          contactLid: evt.contactLid ?? undefined,
          contactPhoneReal: evt.contactPhoneReal ?? undefined,
          lastMessageAt: new Date(evt.sentAt),
          unreadCount: evt.direction === "inbound" ? { increment: 1 } as any : undefined,
        },
      });
      const message = await tx.message.create({
        data: {
          workspaceId: ctx.workspaceId,
          conversationId: conversation.id,
          direction: evt.direction,
          evolutionMessageId: evt.evolutionMessageId,
          type: evt.type,
          body: evt.body,
          mediaUrl: evt.mediaUrl,
          status: "delivered",
          sentAt: new Date(evt.sentAt),
        },
      });
      return { conversation, message };
    });
  }

  return {};
}

function mapStatus(raw: string): "pending" | "sent" | "delivered" | "read" | "failed" {
  const s = raw.toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliv")) return "delivered";
  if (s.includes("sent")) return "sent";
  if (s.includes("fail") || s.includes("error")) return "failed";
  return "pending";
}
