import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { SettingsApi } from "./settings";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("SettingsApi.setSettings", () => {
  it("posts to /settings/set/<name> with the settings payload", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ settings: { rejectCall: true } }), { status: 201 }));
    const api = new SettingsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.setSettings("inst-1", { rejectCall: true, msgCall: "Sorry, can't take calls.", alwaysOnline: false, readMessages: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/settings/set/inst-1");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.rejectCall).toBe(true);
    expect(body.msgCall).toBe("Sorry, can't take calls.");
    expect(body.readMessages).toBe(true);
  });
});

describe("SettingsApi.findSettings", () => {
  it("gets /settings/find/<name>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ rejectCall: false }), { status: 200 }));
    const api = new SettingsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    const out = await api.findSettings("inst-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/settings/find/inst-1");
    expect(init.method).toBe("GET");
    expect(out).toEqual({ rejectCall: false });
  });
});
