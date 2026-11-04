import type { EvolutionClient } from "./client";
import {
  SendResultSchema,
  SendTextInputSchema,
  SendMediaInputSchema,
  type SendResult,
  type SendTextInput,
  type SendMediaInput,
} from "./types";

export class MessageApi {
  constructor(private readonly client: EvolutionClient) {}

  async sendText(instanceName: string, input: SendTextInput): Promise<SendResult> {
    const body = SendTextInputSchema.parse(input);
    const raw = await this.client.request(
      "POST",
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      body
    );
    return SendResultSchema.parse(raw);
  }

  async sendMedia(instanceName: string, input: SendMediaInput): Promise<SendResult> {
    const body = SendMediaInputSchema.parse(input);
    const raw = await this.client.request(
      "POST",
      `/message/sendMedia/${encodeURIComponent(instanceName)}`,
      body
    );
    return SendResultSchema.parse(raw);
  }

  async sendPresence(
    instanceName: string,
    number: string,
    presence: "composing" | "available"
  ): Promise<void> {
    await this.client.request(
      "POST",
      `/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      { number, presence, delay: 0 }
    );
  }
}
