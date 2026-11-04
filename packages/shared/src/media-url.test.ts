import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mediaPublicBaseUrl, assetPublicUrl } from "./media-url";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL;
  saved.AUTH_URL = process.env.AUTH_URL;
  delete process.env.MEDIA_PUBLIC_BASE_URL;
  delete process.env.AUTH_URL;
});

afterEach(() => {
  if (saved.MEDIA_PUBLIC_BASE_URL !== undefined) process.env.MEDIA_PUBLIC_BASE_URL = saved.MEDIA_PUBLIC_BASE_URL;
  if (saved.AUTH_URL !== undefined) process.env.AUTH_URL = saved.AUTH_URL;
});

describe("mediaPublicBaseUrl", () => {
  it("prefers MEDIA_PUBLIC_BASE_URL, then AUTH_URL, then localhost", () => {
    expect(mediaPublicBaseUrl()).toBe("http://localhost:3000");
    process.env.AUTH_URL = "https://app.example.com";
    expect(mediaPublicBaseUrl()).toBe("https://app.example.com");
    process.env.MEDIA_PUBLIC_BASE_URL = "http://web:3000";
    expect(mediaPublicBaseUrl()).toBe("http://web:3000");
  });
});

describe("assetPublicUrl", () => {
  it("builds the raw media route and strips trailing slash", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "http://web:3000/";
    expect(assetPublicUrl("acme", "abc123")).toBe(
      "http://web:3000/api/workspaces/acme/media/abc123/raw",
    );
  });
});
