import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { GroupsApi } from "./groups";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

describe("GroupsApi", () => {
  it("fetchAllGroups GETs /group/fetchAllGroups/<name>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ groups: [] }), { status: 200 }));
    const api = new GroupsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.fetchAllGroups("inst-1", false);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/group/fetchAllGroups/inst-1?getParticipants=false");
    expect(init.method).toBe("GET");
  });

  it("findGroupInfos GETs /group/findGroupInfos/<name>?groupJid=<jid>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ subject: "Test" }), { status: 200 }));
    const api = new GroupsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.findGroupInfos("inst-1", "123-456@g.us");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/group/findGroupInfos/inst-1?groupJid=123-456%40g.us");
  });

  it("participants GETs /group/participants/<name>?groupJid=<jid>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ participants: [] }), { status: 200 }));
    const api = new GroupsApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.participants("inst-1", "123-456@g.us");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/group/participants/inst-1?groupJid=123-456%40g.us");
  });
});
