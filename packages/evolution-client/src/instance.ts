import type { EvolutionClient } from "./client";
import {
  ConnectionStateResponseSchema,
  ConnectResponseSchema,
  CreateInstanceInputSchema,
  CreatedInstanceSchema,
  type ConnectionState,
  type ConnectResponse,
  type CreateInstanceInput,
  type CreatedInstance,
} from "./types";

export class InstanceApi {
  constructor(private readonly client: EvolutionClient) {}

  async create(input: CreateInstanceInput): Promise<CreatedInstance> {
    const body = CreateInstanceInputSchema.parse(input);
    const raw = await this.client.request("POST", "/instance/create", body);
    return CreatedInstanceSchema.parse(raw);
  }

  async connect(instanceName: string): Promise<ConnectResponse> {
    const raw = await this.client.request("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
    return ConnectResponseSchema.parse(raw);
  }

  async connectionState(instanceName: string): Promise<ConnectionState> {
    const raw = await this.client.request("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const parsed = ConnectionStateResponseSchema.parse(raw);
    return parsed.instance.state;
  }

  /** The instance's own WhatsApp phone number (from ownerJid), or null if not connected. */
  async ownerNumber(instanceName: string): Promise<string | null> {
    const raw = await this.client.request<any>(
      "GET",
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    );
    const arr: any[] = Array.isArray(raw) ? raw : raw?.instances ?? [];
    const entry = arr.find((i) => i?.name === instanceName) ?? arr[0];
    const jid: string | undefined = entry?.ownerJid;
    if (!jid) return null;
    return jid.replace(/@.*/, "") || null;
  }

  async logout(instanceName: string): Promise<void> {
    await this.client.request("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.client.request("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }
}
