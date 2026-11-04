import { prisma } from "@evo/db";
import {
  sendViaInstance as rawSendViaInstance,
  type SendTextPayload,
  type SendMediaPayload,
  type SendPayload,
  type SendOptions,
} from "@evo/send";
import { writeAudit } from "./audit";

export type { SendTextPayload, SendMediaPayload, SendPayload, SendOptions } from "@evo/send";

export async function sendViaInstance(instanceId: string, payload: SendPayload, opts: SendOptions = {}) {
  const result = await rawSendViaInstance(instanceId, payload, opts);
  const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
  if (instance) {
    const diff =
      payload.type === "text"
        ? { to: payload.to, textPreview: payload.text.slice(0, 80) }
        : { to: payload.to, mediatype: payload.mediatype, mediaUrl: payload.mediaUrl };
    await writeAudit({
      workspaceId: instance.workspaceId,
      userId: payload.userId,
      action: "message.sent",
      target: `instance:${instance.id}`,
      instanceId: instance.id,
      diff,
    });
  }
  return result;
}
