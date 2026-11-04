import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { IntegrationApi } from "./integration";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("IntegrationApi.chatwootSet", () => {
  it("posts to /chatwoot/set/<name> with config", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = new IntegrationApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.chatwootSet("inst-1", {
      enabled: true,
      accountId: "1",
      token: "chatwoot-token",
      url: "https://chatwoot.example.com",
      nameInbox: "WhatsApp",
      signMsg: true,
      reopenConversation: true,
      conversationPending: false,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chatwoot/set/inst-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).enabled).toBe(true);
  });
});
