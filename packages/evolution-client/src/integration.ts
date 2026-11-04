import type { EvolutionClient } from "./client";

export interface ChatwootConfig {
  enabled: boolean;
  accountId: string;
  token: string;
  url: string;
  nameInbox?: string;
  signMsg?: boolean;
  reopenConversation?: boolean;
  conversationPending?: boolean;
}

export class IntegrationApi {
  constructor(private readonly client: EvolutionClient) {}

  async chatwootSet(instanceName: string, config: ChatwootConfig): Promise<void> {
    await this.client.request("POST", `/chatwoot/set/${encodeURIComponent(instanceName)}`, config);
  }

  async chatwootFind(instanceName: string): Promise<unknown> {
    return this.client.request("GET", `/chatwoot/find/${encodeURIComponent(instanceName)}`);
  }
}
