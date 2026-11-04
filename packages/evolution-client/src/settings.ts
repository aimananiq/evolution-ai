import type { EvolutionClient } from "./client";

export interface InstanceSettings {
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;
}

export class SettingsApi {
  constructor(private readonly client: EvolutionClient) {}

  async setSettings(instanceName: string, input: InstanceSettings): Promise<unknown> {
    return this.client.request("POST", `/settings/set/${encodeURIComponent(instanceName)}`, input);
  }

  async findSettings(instanceName: string): Promise<InstanceSettings> {
    return this.client.request<InstanceSettings>("GET", `/settings/find/${encodeURIComponent(instanceName)}`);
  }
}
