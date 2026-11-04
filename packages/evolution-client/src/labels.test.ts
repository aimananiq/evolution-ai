import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { LabelsApi } from "./labels";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("LabelsApi", () => {
  it("findLabels GETs /label/findLabels/<name> and unwraps {labels}", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ labels: [{ id: "9", name: "Unread", color: 1 }] }), { status: 200 }),
    );
    const api = new LabelsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    const labels = await api.findLabels("inst-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/label/findLabels/inst-1");
    expect(init.method).toBe("GET");
    expect(labels).toEqual([{ id: "9", name: "Unread", color: 1 }]);
  });

  it("findLabels accepts a bare array response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ id: "1", name: "A" }]), { status: 200 }));
    const api = new LabelsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    expect(await api.findLabels("inst-1")).toHaveLength(1);
  });

  it("handleLabel POSTs /label/handleLabel/<name> with the action body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const api = new LabelsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.handleLabel("inst-1", { number: "60123@s.whatsapp.net", labelId: "9", action: "add" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/label/handleLabel/inst-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ number: "60123@s.whatsapp.net", labelId: "9", action: "add" });
  });
});
