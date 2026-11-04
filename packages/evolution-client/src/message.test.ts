import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { MessageApi } from "./message";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("MessageApi.sendText", () => {
  const api = new MessageApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("posts to /message/sendText/<name> with number + text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ key: { id: "ABC" }, status: "PENDING" }), { status: 200 }));
    const result = await api.sendText("inst-1", { number: "60123456789", text: "Hello" });
    expect(result.key.id).toBe("ABC");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/message/sendText/inst-1");
    expect(JSON.parse(init.body)).toEqual({ number: "60123456789", text: "Hello" });
  });
});

describe("MessageApi.sendMedia", () => {
  const api = new MessageApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("posts to /message/sendMedia/<name> with required fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "XYZ" }, status: "PENDING" }), { status: 200 })
    );
    const result = await api.sendMedia("inst-1", {
      number: "60123456789",
      mediatype: "image",
      media: "https://example.com/img.jpg",
      caption: "Hello",
    });
    expect(result.key.id).toBe("XYZ");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/message/sendMedia/inst-1");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      number: "60123456789",
      mediatype: "image",
      media: "https://example.com/img.jpg",
      caption: "Hello",
    });
  });

  it("includes optional fileName and mimetype when provided", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "ABC" }, status: "PENDING" }), { status: 200 })
    );
    await api.sendMedia("inst-2", {
      number: "60111",
      mediatype: "document",
      media: "https://example.com/doc.pdf",
      mimetype: "application/pdf",
      fileName: "invoice.pdf",
    });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(body.mimetype).toBe("application/pdf");
    expect(body.fileName).toBe("invoice.pdf");
  });
});
