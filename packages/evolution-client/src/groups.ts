import type { EvolutionClient } from "./client";

export interface GroupSummary {
  id: string;
  subject?: string;
  size?: number;
  creation?: number;
  desc?: string;
  pictureUrl?: string;
  owner?: string;
}

export interface GroupParticipant {
  /** JID as WhatsApp sends it — often a `…@lid` for LID-migrated groups. */
  id: string;
  /**
   * Real phone-number JID (`…@s.whatsapp.net`) when the instance can resolve the LID.
   * Baileys 7 / Evolution v2.3+ expose it as `phoneNumber`; our patched source also mirrors it as `jid`.
   * Absent/null on Evolution ≤ v2.2 (Baileys 6.x), which never captures the mapping.
   */
  phoneNumber?: string | null;
  jid?: string | null;
  /** The `…@lid` identifier when known. */
  lid?: string | null;
  admin?: string | null;
}

export class GroupsApi {
  constructor(private readonly client: EvolutionClient) {}

  async fetchAllGroups(instanceName: string, getParticipants = false): Promise<GroupSummary[]> {
    const path = `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=${getParticipants}`;
    const result = await this.client.request<any>("GET", path);
    if (Array.isArray(result)) return result;
    if (Array.isArray((result as any)?.groups)) return (result as any).groups;
    return [];
  }

  async findGroupInfos(instanceName: string, groupJid: string): Promise<GroupSummary> {
    const path = `/group/findGroupInfos/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`;
    return this.client.request("GET", path);
  }

  async participants(instanceName: string, groupJid: string): Promise<GroupParticipant[]> {
    const path = `/group/participants/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`;
    const result = await this.client.request<any>("GET", path);
    if (Array.isArray(result)) return result;
    if (Array.isArray((result as any)?.participants)) return (result as any).participants;
    return [];
  }
}
