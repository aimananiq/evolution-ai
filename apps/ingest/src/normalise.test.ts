import { describe, it, expect } from "vitest";
import { normalise } from "./normalise";

describe("normalise", () => {
  it("normalises MESSAGES_UPSERT inbound text", () => {
    const event = {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-1", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "hi there" },
        messageTimestamp: 1700000000,
      },
    };
    const out = normalise(event);
    expect(out).toEqual({
      kind: "message",
      direction: "inbound",
      evolutionMessageId: "EVO-1",
      contactPhone: "60123456789",
      contactLid: null,
      contactPhoneReal: "60123456789",
      contactName: "Aisha",
      type: "text",
      body: "hi there",
      mediaUrl: null,
      sentAt: new Date(1700000000 * 1000).toISOString(),
    });
  });

  it("captures LID + real phone from a DM sent with WhatsApp username privacy (addressingMode=lid)", () => {
    const out = normalise({
      event: "messages.upsert",
      data: {
        key: {
          id: "EVO-LID",
          remoteJid: "157191608791096@lid",
          remoteJidAlt: "6587185009@s.whatsapp.net",
          addressingMode: "lid",
          fromMe: false,
        },
        pushName: "Saritha",
        message: { conversation: "hi from an ad" },
        messageTimestamp: 1700000002,
      },
    });
    if (out?.kind !== "message") throw new Error("expected message");
    expect(out.contactLid).toBe("157191608791096");
    expect(out.contactPhoneReal).toBe("6587185009");
    // contactPhone keeps the stripped remoteJid (unchanged keying — no split).
    expect(out.contactPhone).toBe("157191608791096");
  });

  it("captures participant LID + phone from a group message", () => {
    const out = normalise({
      event: "messages.upsert",
      data: {
        key: {
          id: "EVO-GRP",
          remoteJid: "120363427237971667@g.us",
          participant: "137782685085828@lid",
          participantAlt: "60185730027@s.whatsapp.net",
          addressingMode: "lid",
          fromMe: false,
        },
        pushName: "Rushdina",
        message: { conversation: "hello group" },
        messageTimestamp: 1700000003,
      },
    });
    if (out?.kind !== "message") throw new Error("expected message");
    expect(out.contactLid).toBe("137782685085828");
    expect(out.contactPhoneReal).toBe("60185730027");
  });

  it("normalises MESSAGES_UPSERT outbound (fromMe)", () => {
    const out = normalise({
      event: "messages.upsert",
      data: {
        key: { id: "EVO-2", remoteJid: "60123@s.whatsapp.net", fromMe: true },
        message: { conversation: "echo" },
        messageTimestamp: 1700000001,
      },
    });
    expect(out?.kind).toBe("message");
    if (out?.kind === "message") expect(out.direction).toBe("outbound");
  });

  it("normalises CONNECTION_UPDATE", () => {
    const out = normalise({
      event: "connection.update",
      data: { state: "open" },
    });
    expect(out).toEqual({ kind: "connection", state: "open" });
  });

  it("returns null for unknown events", () => {
    expect(normalise({ event: "presence.update", data: {} })).toBeNull();
    expect(normalise({})).toBeNull();
  });
});
