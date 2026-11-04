import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: { webhookDeliveryLog: { create: vi.fn() } },
}));
vi.mock("@evo/queue", () => ({ redis: () => ({}) }));
vi.mock("bullmq", () => ({ Queue: class { add() {} } }));

const { prisma } = await import("@evo/db");
const { deliverWebhook } = await import("./io");

const job = (over: Record<string, unknown> = {}) => ({
  data: {
    workspaceId: "w1", subscriptionId: "s1", url: "http://hook", secret: "sec",
    event: "message.received", body: '{"event":"message.received"}', at: "2026-07-04T00:00:00.000Z",
    ...over,
  },
});

// The mock host "hook" doesn't resolve; opt it past the SSRF guard so these tests
// exercise the delivery path (the guard itself is covered by @evo/shared ssrf tests).
beforeEach(() => {
  vi.clearAllMocks();
  process.env.SSRF_ALLOW_HOSTS = "hook";
});

describe("deliverWebhook", () => {
  it("POSTs the signed body and logs ok on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await deliverWebhook(job());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://hook");
    expect((opts.headers as any)["x-webhook-signature"]).toMatch(/^sha256=/);
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ok: true, statusCode: 200 }) }),
    );
  });

  it("logs failure and throws (for BullMQ retry) on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(deliverWebhook(job())).rejects.toThrow();
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ok: false, statusCode: 500 }) }),
    );
  });

  it("logs failure and throws on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(deliverWebhook(job())).rejects.toThrow();
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ok: false }) }),
    );
  });

  it("blocks an internal URL without fetching, and does not throw (no retry)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await deliverWebhook(job({ url: "http://127.0.0.1:9000/x" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhookDeliveryLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ok: false, error: expect.stringContaining("blocked") }) }),
    );
  });
});
