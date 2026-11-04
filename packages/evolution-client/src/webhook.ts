import type { EvolutionClient } from "./client";
import { WebhookSetInputSchema, type WebhookSetInput } from "./types";

export class WebhookApi {
  constructor(private readonly client: EvolutionClient) {}

  async set(instanceName: string, input: WebhookSetInput): Promise<void> {
    const body = WebhookSetInputSchema.parse(input);
    await this.client.request("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, body);
  }

  async find(instanceName: string): Promise<unknown> {
    return this.client.request("GET", `/webhook/find/${encodeURIComponent(instanceName)}`);
  }
}
