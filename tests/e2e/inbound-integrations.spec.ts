/**
 * e2e: inbound integration roundtrip
 *
 * Harness mirrors automation.spec.ts / inbox-roundtrip.spec.ts exactly:
 *  - freshEmail / resetDb from playwright.helpers
 *  - inline stub Evolution HTTP server (needed for instance create/pair)
 *  - sign-up via page navigation; workspace slug parsed from URL
 *  - instance created via UI; instanceId parsed from URL
 *  - session cookie extracted from browser context
 *  - inbound integration created via session-authed web API
 *  - sample payload POSTed to the ingest public receiver (localhost:4000)
 *  - log rows polled via the web API for assertions
 *
 * The inbound-send worker is not asserted against a live Evolution stub here
 * because the worker queue runs asynchronously and is covered by unit tests.
 * We assert the log/queue side-effects only.
 *
 * Stub runs on port 18085 (no conflict with ports 18081-18084 used by other specs).
 */

import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18085;
const INGEST_BASE = "http://localhost:4000";

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          instance: { instanceName: "stub" },
          hash: "stub-key",
          qrcode: { base64: "data:image/png;base64,iVBORw0KGgo=" },
        })
      );
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub", state: "open" } }));
      return;
    }
    if (req.url?.startsWith("/webhook/set/")) {
      res.writeHead(200);
      res.end(JSON.stringify({ webhook: { enabled: true } }));
      return;
    }
    if (req.url?.startsWith("/message/sendText/")) {
      res.writeHead(200);
      res.end(JSON.stringify({ key: { id: "EVO-INBOUND-REPLY" }, status: "PENDING" }));
      return;
    }
    if (req.url?.startsWith("/chat/sendPresence/")) {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => stub.listen(STUB_PORT, r));
});

test.afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});

test("inbound integration: create, receive, resolve recipient, log", async ({ browser, request }) => {
  // ── 1. Sign up + create workspace ────────────────────────────────────────────
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("inbound");

  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Inbound Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // ── 2. Create an instance (registers with the stub Evolution server) ──────────
  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Inbound WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);
  const instanceId = page.url().match(/instances\/([^/]+)\/pair/)![1];

  // ── 3. Extract session cookie for API calls ───────────────────────────────────
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  // ── 4. Create the inbound integration via the session-authed web API ──────────
  const createRes = await request.post(
    `http://localhost:3000/api/workspaces/${slug}/inbound-integrations`,
    {
      headers: { cookie: cookieHeader },
      data: {
        instanceId,
        recipientPathKey: "billing.billing_phone",
        captionTemplate: "Hi {{billing.first_name}}",
        enabled: true,
      },
    }
  );
  expect(createRes.status()).toBe(201);
  const { integration } = await createRes.json();
  expect(integration.id).toBeTruthy();
  // webhookUrl is built from WEBHOOK_PUBLIC_BASE_URL (env) + /integration_webhook/:token
  expect(integration.webhookUrl).toContain("/integration_webhook/");
  const token = integration.webhookUrl.split("/integration_webhook/")[1];
  expect(token).toBeTruthy();

  // ── 5. POST a sample payload to the PUBLIC ingest receiver (no auth) ──────────
  const hookRes = await request.post(`${INGEST_BASE}/integration_webhook/${token}`, {
    data: { billing: { billing_phone: "+60 12-345 6789", first_name: "Aiman" } },
  });
  expect(hookRes.status()).toBe(200);
  const hookBody = await hookRes.json();
  expect(hookBody.ok).toBe(true);

  // ── 6. Poll the logs API until recipient resolves ─────────────────────────────
  await expect
    .poll(
      async () => {
        const logsRes = await request.get(
          `http://localhost:3000/api/workspaces/${slug}/inbound-integrations/${integration.id}/logs`,
          { headers: { cookie: cookieHeader } }
        );
        const { logs } = await logsRes.json();
        return logs[0]?.resolvedPhone ?? null;
      },
      { timeout: 10000, intervals: [500] }
    )
    .toBe("60123456789");

  // ── 7. Missing recipient -> 422 + no_recipient log ────────────────────────────
  const bad = await request.post(`${INGEST_BASE}/integration_webhook/${token}`, {
    data: { billing: {} },
  });
  expect(bad.status()).toBe(422);
  const badBody = await bad.json();
  expect(badBody.error).toBe("NO_RECIPIENT");

  await expect
    .poll(
      async () => {
        const logsRes = await request.get(
          `http://localhost:3000/api/workspaces/${slug}/inbound-integrations/${integration.id}/logs`,
          { headers: { cookie: cookieHeader } }
        );
        const { logs } = await logsRes.json();
        return logs.some((l: { status: string }) => l.status === "no_recipient");
      },
      { timeout: 10000, intervals: [500] }
    )
    .toBe(true);

  // ── 8. Unknown token -> 404 ───────────────────────────────────────────────────
  const notFound = await request.post(`${INGEST_BASE}/integration_webhook/totally-unknown-token`, {
    data: { any: "payload" },
  });
  expect(notFound.status()).toBe(404);

  await ctx.close();
});
