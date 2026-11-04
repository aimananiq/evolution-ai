import { sendViaInstance, mediaPayloadFromAsset } from "@evo/send";
import { renderTemplate, type BotAction, type TemplateVars } from "@evo/flow-actions";
import { redis } from "@evo/queue";

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ActionContext {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  contactName: string;
  contactId: string; // resolved upstream; "" if no Contact row
  inboundText: string;
  triggerId?: string; // optional: used to persist rotator cursor in Redis
}

function varsFor(ctx: ActionContext): TemplateVars {
  return {
    contact: { name: ctx.contactName, phone: ctx.contactPhone },
    response: ctx.inboundText,
  };
}

/** Run the action chain in order. Returns true if a pending state was parked (caller should stop). */
export async function executeActions(ctx: ActionContext, actions: BotAction[]): Promise<boolean> {
  const { prisma } = await import("@evo/db");
  const vars = varsFor(ctx);
  let rotatorIdx = 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    switch (action.type) {
      case "send_text": {
        const text = renderTemplate(action.text, vars);
        // Media action (Plan 7): send the asset with the rendered text as caption; text fallback.
        const mediaPayload = action.mediaAssetId
          ? await mediaPayloadFromAsset(action.mediaAssetId, ctx.workspaceId, ctx.contactPhone, text)
          : null;
        await sendViaInstance(
          ctx.instanceId,
          mediaPayload ?? { type: "text", to: ctx.contactPhone, text, userId: null },
          { origin: "chatbot" },
        );
        break;
      }
      case "add_labels": {
        if (ctx.contactId) {
          for (const labelId of action.labelIds) {
            await prisma.contactLabel.upsert({
              where: { contactId_labelId: { contactId: ctx.contactId, labelId } },
              create: { contactId: ctx.contactId, labelId },
              update: {},
            });
          }
        }
        break;
      }
      case "remove_labels": {
        if (ctx.contactId) {
          await prisma.contactLabel.deleteMany({
            where: { contactId: ctx.contactId, labelId: { in: action.labelIds } },
          });
        }
        break;
      }
      case "add_to_group": {
        if (ctx.contactId) {
          for (const listId of action.listIds) {
            await prisma.contactListMember.upsert({
              where: { listId_contactId: { listId, contactId: ctx.contactId } },
              create: { listId, contactId: ctx.contactId },
              update: {},
            });
          }
        }
        break;
      }
      case "remove_from_group": {
        if (ctx.contactId) {
          await prisma.contactListMember.deleteMany({
            where: { contactId: ctx.contactId, listId: { in: action.listIds } },
          });
        }
        break;
      }
      case "forward_message": {
        let targets: string[];
        if (action.mode === "rotator") {
          let idx: number;
          if (ctx.triggerId) {
            const key = `rotator:${ctx.triggerId}:${i}`;
            const n = await redis().incr(key);
            idx = (n - 1) % action.numbers.length;
          } else {
            idx = rotatorIdx++ % action.numbers.length;
          }
          targets = [action.numbers[idx]!];
        } else {
          targets = action.numbers;
        }
        for (const to of targets) {
          await sendViaInstance(ctx.instanceId, {
            type: "text",
            to: to!,
            text: `Forwarded from ${ctx.contactPhone}: ${ctx.inboundText}`,
            userId: null,
          }, { origin: "chatbot" });
        }
        break;
      }
      case "rest_api": {
        const body = renderTemplate(action.bodyTemplate, vars);
        try {
          await fetch(action.url, {
            method: action.method,
            headers: { "content-type": "application/json", ...action.headers },
            body: action.method === "GET" ? undefined : body || undefined,
          });
        } catch {
          // external endpoint failures must not break the chain
        }
        break;
      }
      case "save_response": {
        if (action.prompt) {
          await sendViaInstance(ctx.instanceId, {
            type: "text",
            to: ctx.contactPhone,
            text: renderTemplate(action.prompt, vars),
            userId: null,
          }, { origin: "chatbot" });
        }
        await parkPending(ctx, "save_response", { fieldKey: action.fieldKey });
        return true;
      }
      case "next_action": {
        await parkPending(ctx, "next_action", { keyword: action.keyword });
        return true;
      }
    }
  }
  return false;
}

async function parkPending(
  ctx: ActionContext,
  kind: "save_response" | "next_action",
  payload: Record<string, unknown>
): Promise<void> {
  const { prisma } = await import("@evo/db");
  await prisma.botPendingState.upsert({
    where: { conversationId: ctx.conversationId },
    create: {
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      contactPhone: ctx.contactPhone,
      kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: payload as any,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: { kind, payload: payload as any, expiresAt: new Date(Date.now() + PENDING_TTL_MS) },
  });
}
