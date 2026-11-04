import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { WebhookApi } from "./webhook";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("WebhookApi.set", () => {
  it("posts to /webhook/set/<name> with the webhook payload", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ webhook: { enabled: true } }), { status: 200 }));
    const api = new WebhookApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.set("inst-1", {
      webhook: {
        enabled: true,
        url: "https://example.com/hook",
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/webhook/set/inst-1");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.webhook.url).toBe("https://example.com/hook");
    expect(body.webhook.events).toEqual(["MESSAGES_UPSERT", "CONNECTION_UPDATE"]);
  });
});
