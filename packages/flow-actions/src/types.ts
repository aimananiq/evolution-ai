import { z } from "zod";

export const sendTextActionSchema = z.object({
  type: z.literal("send_text"),
  text: z.string().min(1).max(4000),
  presenceDelaySec: z.number().int().min(0).max(30).default(0),
  mediaAssetId: z.string().nullable().default(null), // Plan 7: resolved to media once available
});

export const saveResponseActionSchema = z.object({
  type: z.literal("save_response"),
  // key under Contact.customFields to store the contact's NEXT inbound message
  fieldKey: z.string().min(1).max(80),
  prompt: z.string().max(4000).optional(), // optional text sent asking for the response
});

export const forwardMessageActionSchema = z.object({
  type: z.literal("forward_message"),
  mode: z.enum(["all", "rotator"]).default("all"),
  // "all": forward to every number; "rotator": round-robin one number per inbound
  numbers: z.array(z.string().min(5).max(20)).min(1),
});

export const addLabelsActionSchema = z.object({
  type: z.literal("add_labels"),
  labelIds: z.array(z.string()).min(1),
});

export const removeLabelsActionSchema = z.object({
  type: z.literal("remove_labels"),
  labelIds: z.array(z.string()).min(1),
});

export const addToGroupActionSchema = z.object({
  type: z.literal("add_to_group"),
  listIds: z.array(z.string()).min(1),
});

export const removeFromGroupActionSchema = z.object({
  type: z.literal("remove_from_group"),
  listIds: z.array(z.string()).min(1),
});

export const restApiActionSchema = z.object({
  type: z.literal("rest_api"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
  bodyTemplate: z.string().max(8000).default(""), // templated with {{vars}}
});

export const nextActionActionSchema = z.object({
  type: z.literal("next_action"),
  // chain to another rule on this chatbot, matched by keyword on the contact's NEXT message
  keyword: z.string().min(1).max(80),
});

export const actionSchema = z.discriminatedUnion("type", [
  sendTextActionSchema,
  saveResponseActionSchema,
  forwardMessageActionSchema,
  addLabelsActionSchema,
  removeLabelsActionSchema,
  addToGroupActionSchema,
  removeFromGroupActionSchema,
  restApiActionSchema,
  nextActionActionSchema,
]);

export const actionsSchema = z.array(actionSchema).max(20);

export type BotAction = z.infer<typeof actionSchema>;
export type BotActionType = BotAction["type"];

/** Parse an unknown Json value into a validated action array; throws on invalid shape. */
export function parseActions(value: unknown): BotAction[] {
  if (value == null) return [];
  return actionsSchema.parse(value);
}
