export type NormalisedEvent =
  | {
      kind: "message";
      direction: "inbound" | "outbound";
      evolutionMessageId: string;
      contactPhone: string;
      contactLid?: string | null;
      contactPhoneReal?: string | null;
      contactName: string | null;
      type: string;
      body: string | null;
      mediaUrl: string | null;
      sentAt: string;
    }
  | { kind: "connection"; state: "unknown" | "connecting" | "open" | "close" }
  | { kind: "message-status"; evolutionMessageId: string; status: string };

function stripJid(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

// WhatsApp LID (username privacy): a message carries the sender's hidden `@lid`
// and, when known, their real phone as an `@s.whatsapp.net` "alt". For a DM the
// pair is remoteJid/remoteJidAlt; for a group it's participant/participantAlt.
function lidPart(jid: string): string | null {
  return jid.endsWith("@lid") ? stripJid(jid) : null;
}
function phonePart(jid: string): string | null {
  return jid.endsWith("@s.whatsapp.net") ? stripJid(jid) : null;
}

export function normalise(raw: any): NormalisedEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const event = String(raw.event ?? "").toLowerCase();

  if (event === "messages.upsert" && raw.data?.key?.id) {
    const data = raw.data;
    const key = data.key ?? {};
    const direction = key.fromMe ? "outbound" : "inbound";
    const msg = data.message ?? {};
    const body = msg.conversation ?? msg.extendedTextMessage?.text ?? null;
    const ts = Number(data.messageTimestamp ?? 0) * 1000;
    // Identify the contact. contactPhone keeps its existing value (stripped
    // remoteJid) so conversation keying is unchanged; contactLid + contactPhoneReal
    // are captured alongside for the LID export. For a group message the sender is
    // key.participant/participantAlt; for a DM it's remoteJid/remoteJidAlt.
    const remoteJid = String(key.remoteJid ?? "");
    const isGroup = remoteJid.endsWith("@g.us");
    const idJid = isGroup ? String(key.participant ?? "") : remoteJid;
    const idAlt = isGroup ? String(key.participantAlt ?? "") : String(key.remoteJidAlt ?? "");
    return {
      kind: "message",
      direction,
      evolutionMessageId: String(key.id),
      contactPhone: stripJid(remoteJid),
      contactLid: lidPart(idJid),
      contactPhoneReal: phonePart(idAlt) ?? phonePart(idJid),
      contactName: data.pushName ?? null,
      type: "text",
      body,
      mediaUrl: null,
      sentAt: new Date(ts || Date.now()).toISOString(),
    };
  }

  if (event === "messages.update" && raw.data?.key?.id) {
    return {
      kind: "message-status",
      evolutionMessageId: String(raw.data.key.id),
      status: String(raw.data.update?.status ?? "delivered").toLowerCase(),
    };
  }

  if (event === "connection.update" && raw.data?.state) {
    const state = String(raw.data.state).toLowerCase();
    if (state === "open" || state === "close" || state === "connecting") {
      return { kind: "connection", state };
    }
    return { kind: "connection", state: "unknown" };
  }

  return null;
}
