import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@evo/db", () => ({
  prisma: {
    instance: { findUnique: vi.fn() },
    instanceHealthPolicy: { findUnique: vi.fn() },
    mediaAsset: { findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));
vi.mock("@evo/queue", () => ({
  redis: vi.fn(),
  tokenBucket: () => ({ take: async () => ({ granted: true, waitedMs: 0, remaining: 9 }) }),
}));
vi.mock("@evo/evolution-client", () => ({
  EvolutionClient: class {},
  MessageApi: class {},
}));

const { prisma } = await import("@evo/db");
const { mediaPayloadFromAsset } = await import("./media");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MEDIA_PUBLIC_BASE_URL = "http://web:3000";
});

describe("mediaPayloadFromAsset", () => {
  it("resolves an asset into a media payload with public URL and caption", async () => {
    (prisma.mediaAsset.findFirst as any).mockResolvedValue({
      id: "a1", kind: "image", mimetype: "image/png", filename: "promo.png",
    });
    (prisma.workspace.findUnique as any).mockResolvedValue({ slug: "acme" });
    const p = await mediaPayloadFromAsset("a1", "w1", "60123", "hello");
    expect(p).toEqual({
      type: "media",
      to: "60123",
      mediaUrl: "http://web:3000/api/workspaces/acme/media/a1/raw",
      mediatype: "image",
      mimetype: "image/png",
      caption: "hello",
      fileName: "promo.png",
      userId: null,
    });
    // tenant scoping enforced in the query
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", workspaceId: "w1" } }),
    );
  });

  it("omits blank captions", async () => {
    (prisma.mediaAsset.findFirst as any).mockResolvedValue({
      id: "a1", kind: "document", mimetype: "application/pdf", filename: "f.pdf",
    });
    (prisma.workspace.findUnique as any).mockResolvedValue({ slug: "acme" });
    const p = await mediaPayloadFromAsset("a1", "w1", "60123", "  ");
    expect(p?.caption).toBeUndefined();
  });

  it("returns null when the asset is missing or cross-workspace", async () => {
    (prisma.mediaAsset.findFirst as any).mockResolvedValue(null);
    const p = await mediaPayloadFromAsset("nope", "w1", "60123", "x");
    expect(p).toBeNull();
  });
});
