import type { EvolutionClient } from "./client";

/** A WhatsApp chat label as returned by Evolution's `/label/findLabels`. */
export interface WaLabel {
  id: string;
  name: string;
  /** WhatsApp colour index (0-19) or a hex string, depending on Baileys version. */
  color?: string | number;
  predefinedId?: string | null;
}

export type LabelAction = "add" | "remove";

export class LabelsApi {
  constructor(private readonly client: EvolutionClient) {}

  /** List all WhatsApp labels for an instance. */
  async findLabels(instanceName: string): Promise<WaLabel[]> {
    const path = `/label/findLabels/${encodeURIComponent(instanceName)}`;
    const result = await this.client.request<any>("GET", path);
    if (Array.isArray(result)) return result;
    if (Array.isArray((result as any)?.labels)) return (result as any).labels;
    return [];
  }

  /** Add or remove a label on a chat (number is a JID or bare phone). */
  async handleLabel(
    instanceName: string,
    input: { number: string; labelId: string; action: LabelAction },
  ): Promise<unknown> {
    const path = `/label/handleLabel/${encodeURIComponent(instanceName)}`;
    return this.client.request("POST", path, input);
  }
}
