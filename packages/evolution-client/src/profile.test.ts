import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolutionClient } from "./client";
import { ProfileApi } from "./profile";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

describe("ProfileApi", () => {
  it("fetchProfile posts to /chat/fetchProfile/<name>", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: "Eman" }), { status: 200 }));
    const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.fetchProfile("inst-1", "60123@s.whatsapp.net");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chat/fetchProfile/inst-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).number).toBe("60123@s.whatsapp.net");
  });
  it("updateProfileName posts to /chat/updateProfileName/<name>", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.updateProfileName("inst-1", "New Name");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chat/updateProfileName/inst-1");
    expect(JSON.parse(init.body).name).toBe("New Name");
  });
  it("updateProfileStatus posts to /chat/updateProfileStatus/<name>", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const api = new ProfileApi(new EvolutionClient({ baseUrl: "http://evo", apiKey: "K" }));
    await api.updateProfileStatus("inst-1", "Busy");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo/chat/updateProfileStatus/inst-1");
    expect(JSON.parse(init.body).status).toBe("Busy");
  });
});
