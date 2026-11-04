import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { EvolutionAuthError, EvolutionNotFoundError, EvolutionRateLimitError, EvolutionError } from "./errors";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("EvolutionClient.request", () => {
  it("sends apikey header and JSON body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await c.request("POST", "/path", { hello: "world" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/path");
    expect(init.method).toBe("POST");
    expect(init.headers["apikey"]).toBe("K");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("returns parsed JSON on 200", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    const result = await c.request("GET", "/x");
    expect(result).toEqual({ id: 1 });
  });

  it("throws EvolutionAuthError on 401/403", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionAuthError);
  });

  it("throws EvolutionNotFoundError on 404", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionNotFoundError);
  });

  it("throws EvolutionRateLimitError on 429", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    await expect(c.request("GET", "/x")).rejects.toBeInstanceOf(EvolutionRateLimitError);
  });

  it("throws generic EvolutionError on 500", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const c = new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = await c.request("GET", "/x").catch((e) => e) as EvolutionError;
    expect(err).toBeInstanceOf(EvolutionError);
    expect(err.status).toBe(500);
  });
});
