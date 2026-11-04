import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { InstanceApi } from "./instance";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("InstanceApi", () => {
  const api = new InstanceApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));

  it("create returns parsed instance + qr", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ instance: { instanceName: "x" }, qrcode: { base64: "data:abc" } }), { status: 200 })
    );
    const res = await api.create({ instanceName: "x" });
    expect(res.instance.instanceName).toBe("x");
    expect(res.qrcode?.base64).toBe("data:abc");
  });

  it("connectionState returns the state enum", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ instance: { instanceName: "x", state: "open" } }), { status: 200 })
    );
    const state = await api.connectionState("x");
    expect(state).toBe("open");
  });

  it("connect returns qr response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ base64: "data:img", code: "1@..." }), { status: 200 })
    );
    const res = await api.connect("x");
    expect(res.base64).toBe("data:img");
  });

  it("deleteInstance calls DELETE and resolves void", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    await expect(api.deleteInstance("x")).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
  });
});
