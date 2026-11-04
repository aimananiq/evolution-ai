import type { EvolutionClient } from "./client";

export class ProfileApi {
  constructor(private readonly client: EvolutionClient) {}

  fetchProfile(instanceName: string, number: string) {
    return this.client.request("POST", `/chat/fetchProfile/${encodeURIComponent(instanceName)}`, { number });
  }

  updateProfileName(instanceName: string, name: string) {
    return this.client.request("POST", `/chat/updateProfileName/${encodeURIComponent(instanceName)}`, { name });
  }

  updateProfileStatus(instanceName: string, status: string) {
    return this.client.request("POST", `/chat/updateProfileStatus/${encodeURIComponent(instanceName)}`, { status });
  }
}
