import type { EvolutionClient } from "./client";
import { WhatsappNumbersResultSchema, type WhatsappNumberCheck } from "./types";

export class ContactApi {
  constructor(private readonly client: EvolutionClient) {}

  async checkNumbers(instanceName: string, numbers: string[]): Promise<WhatsappNumberCheck[]> {
    const raw = await this.client.request(
      "POST",
      `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
      { numbers }
    );
    return WhatsappNumbersResultSchema.parse(raw);
  }
}
