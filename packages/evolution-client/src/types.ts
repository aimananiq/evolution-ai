import { z } from "zod";

export const ConnectionStateSchema = z.enum(["unknown", "connecting", "open", "close"]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

export const CreateInstanceInputSchema = z.object({
  instanceName: z.string().min(1),
  qrcode: z.boolean().optional().default(true),
  integration: z.literal("WHATSAPP-BAILEYS").optional().default("WHATSAPP-BAILEYS"),
});
export type CreateInstanceInput = z.input<typeof CreateInstanceInputSchema>;

export const CreatedInstanceSchema = z.object({
  instance: z.object({ instanceName: z.string(), instanceId: z.string().nullish() }),
  hash: z.string().nullish(),
  qrcode: z.object({ base64: z.string().nullish(), code: z.string().nullish() }).nullish(),
});
export type CreatedInstance = z.infer<typeof CreatedInstanceSchema>;

// Evolution 2.3.x returns explicit nulls for absent fields, so nullish (null|undefined) not optional.
export const ConnectResponseSchema = z.object({
  base64: z.string().nullish(),
  code: z.string().nullish(),
  pairingCode: z.string().nullish(),
});
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>;

export const ConnectionStateResponseSchema = z.object({
  instance: z.object({ instanceName: z.string(), state: ConnectionStateSchema }),
});
export type ConnectionStateResponse = z.infer<typeof ConnectionStateResponseSchema>;

export const SendTextInputSchema = z.object({
  number: z.string().min(1),
  text: z.string().min(1),
});
export type SendTextInput = z.infer<typeof SendTextInputSchema>;

export const SendResultSchema = z.object({
  key: z.object({ id: z.string() }).passthrough(),
  status: z.string().optional(),
}).passthrough();
export type SendResult = z.infer<typeof SendResultSchema>;

export const WebhookEventSchema = z.enum([
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "CONTACTS_UPSERT",
  "CONTACTS_UPDATE",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
  "CHATS_DELETE",
  "PRESENCE_UPDATE",
]);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WebhookSetInputSchema = z.object({
  webhook: z.object({
    enabled: z.boolean(),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    byEvents: z.boolean().optional().default(false),
    base64: z.boolean().optional().default(true),
    events: z.array(WebhookEventSchema),
  }),
});
export type WebhookSetInput = z.input<typeof WebhookSetInputSchema>;

export const WhatsappNumberCheckSchema = z.object({
  jid: z.string(),
  exists: z.boolean(),
  number: z.string(),
});
export type WhatsappNumberCheck = z.infer<typeof WhatsappNumberCheckSchema>;

export const WhatsappNumbersResultSchema = z.array(WhatsappNumberCheckSchema);

export const SendMediaInputSchema = z.object({
  number: z.string().min(1),
  mediatype: z.enum(["image", "document", "video", "audio"]),
  media: z.string().min(1),          // URL (preferred) or base64
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  fileName: z.string().optional(),
});
export type SendMediaInput = z.input<typeof SendMediaInputSchema>;
