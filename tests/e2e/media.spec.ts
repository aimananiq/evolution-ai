import { test, expect } from "@playwright/test";
import { freshEmail, resetDb } from "./playwright.helpers";

/**
 * Media file manager e2e tests.
 *
 * Harness: matches every other spec in this directory —
 *   - resetDb() in beforeAll
 *   - fresh sign-up via browser UI (no hand-rolled credentials POST)
 *   - session cookie extracted from the browser context
 *   - API calls made via Playwright `request` with that cookie header
 *
 * No Evolution stub required: the media endpoints are pure file storage;
 * they do not call the Evolution API.
 *
 * Test goals (all via API request context, not through the browser UI):
 *   1. POST /api/workspaces/[slug]/media — upload a 1×1 PNG → 201, kind=image
 *   2. GET  /api/workspaces/[slug]/media — list includes the uploaded asset
 *   3. GET  /api/workspaces/[slug]/media/[id]/raw — returns image/png bytes
 *   4. DELETE /api/workspaces/[slug]/media/[id] — removes asset;
 *        list no longer contains it; raw returns 404
 */

// A tiny 1×1 red PNG — 68 bytes, valid image/png
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";

test.beforeAll(() => {
  resetDb();
});

test("media upload → list → raw bytes → delete", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("media");
  const pw = "hunter22hunter";

  // ── Sign up ──────────────────────────────────────────────────────────────
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(pw);
  await page.getByRole("button", { name: /Create account/i }).click();

  // ── Create workspace ──────────────────────────────────────────────────────
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Media Test Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");

  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // ── Extract session cookies ───────────────────────────────────────────────
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const baseUrl = "http://localhost:3000";

  // ── 1. Upload a tiny PNG ──────────────────────────────────────────────────
  const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");

  const uploadRes = await request.post(
    `${baseUrl}/api/workspaces/${slug}/media`,
    {
      headers: { cookie: cookieHeader },
      multipart: {
        file: { name: "test-image.png", mimeType: "image/png", buffer: pngBytes },
      },
    }
  );

  expect(uploadRes.status()).toBe(201);
  const uploadBody = await uploadRes.json();
  expect(uploadBody.asset).toBeDefined();
  expect(uploadBody.asset.filename).toBe("test-image.png");
  expect(uploadBody.asset.kind).toBe("image");

  const assetId: string = uploadBody.asset.id;
  expect(assetId).toBeTruthy();

  // ── 2. List includes the uploaded asset ──────────────────────────────────
  const listRes = await request.get(
    `${baseUrl}/api/workspaces/${slug}/media`,
    { headers: { cookie: cookieHeader } }
  );
  expect(listRes.status()).toBe(200);
  const { assets } = await listRes.json();
  const found = (assets as any[]).find((a: any) => a.id === assetId);
  expect(found).toBeDefined();
  expect(found.filename).toBe("test-image.png");
  expect(found.kind).toBe("image");

  // ── 3. Raw route returns image/png bytes ──────────────────────────────────
  const rawRes = await request.get(
    `${baseUrl}/api/workspaces/${slug}/media/${assetId}/raw`
    // raw route is intentionally unauthenticated — no cookie needed
  );
  expect(rawRes.status()).toBe(200);
  expect(rawRes.headers()["content-type"]).toContain("image/png");
  const rawBytes = await rawRes.body();
  expect(rawBytes.byteLength).toBeGreaterThan(0);

  // ── 4. Delete → list empty, raw 404 ──────────────────────────────────────
  const deleteRes = await request.delete(
    `${baseUrl}/api/workspaces/${slug}/media/${assetId}`,
    { headers: { cookie: cookieHeader } }
  );
  expect(deleteRes.status()).toBe(200);
  const deleteBody = await deleteRes.json();
  expect(deleteBody.ok).toBe(true);

  // List no longer contains the asset
  const listAfterRes = await request.get(
    `${baseUrl}/api/workspaces/${slug}/media`,
    { headers: { cookie: cookieHeader } }
  );
  const { assets: assetsAfter } = await listAfterRes.json();
  const stillThere = (assetsAfter as any[]).find((a: any) => a.id === assetId);
  expect(stillThere).toBeUndefined();

  // Raw route returns 404
  const rawAfterRes = await request.get(
    `${baseUrl}/api/workspaces/${slug}/media/${assetId}/raw`
  );
  expect(rawAfterRes.status()).toBe(404);
});
