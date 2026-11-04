import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { ContactApi } from "./contact";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("ContactApi.checkNumbers", () => {
  it("posts to /chat/whatsappNumbers/<name> with the numbers array", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([
      { jid: "60123@s.whatsapp.net", exists: true, number: "60123" },
      { jid: "60999@s.whatsapp.net", exists: false, number: "60999" },
    ]), { status: 200 }));
    const api = new ContactApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    const result = await api.checkNumbers("inst-1", ["60123", "60999"]);
    expect(result).toHaveLength(2);
    expect(result[0]?.exists).toBe(true);
    expect(result[1]?.exists).toBe(false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chat/whatsappNumbers/inst-1");
    expect(JSON.parse(init.body)).toEqual({ numbers: ["60123", "60999"] });
  });
});
