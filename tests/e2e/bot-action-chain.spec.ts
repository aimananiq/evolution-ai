/**
 * e2e: bot action chain — add_labels + send_text fire on keyword match
 *
 * Harness mirrors automation.spec.ts exactly:
 *  - freshEmail / resetDb from playwright.helpers
 *  - inline stub Evolution HTTP server captures outbound sendText calls
 *  - sign-up via page navigation; workspace slug parsed from URL
 *  - chatbot + trigger created via the web API (cookie-authed)
 *  - inbound webhook POSTed to ingest service (localhost:4000)
 *  - assertions poll the stub server + web API
 *
 * The stub runs on port 18084 (one above automation.spec.ts port 18083)
 * so both suites can run in the same worker pool without conflict.
 */

import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18084;
const sentMessages: Array<{ to: string; text: string }> = [];

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");

    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub" }, hash: "stub-key" }));
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
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      sentMessages.push({ to: body.number ?? "", text: body.text ?? "" });
      res.writeHead(200);
      res.end(
        JSON.stringify({ key: { id: `EVO-OUT-${sentMessages.length}` }, status: "PENDING" })
      );
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

test("rule action chain: add_labels + send_text fire on keyword match", async ({
  browser,
  request,
}) => {
  sentMessages.length = 0;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("chain");

  // ── 1. Sign up + create workspace ────────────────────────────────────────────
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Chain Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Chain Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // ── 2. Create an instance (registers with stub Evolution on STUB_PORT) ───────
  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Chain WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);

  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const instsRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances`, {
    headers: { cookie: cookieHeader },
  });
  const { instances } = await instsRes.json();
  const instance = instances[0];

  // ── 3. Create a Label "VIP" ──────────────────────────────────────────────────
  const labelRes = await request.post(
    `http://localhost:3000/api/workspaces/${slug}/labels`,
    { headers: { cookie: cookieHeader }, data: { name: "VIP" } }
  );
  expect(labelRes.ok()).toBe(true);
  const { label } = await labelRes.json();
  expect(label.id).toBeTruthy();

  // ── 4. Pre-create the Contact so add_labels can find it ─────────────────────
  // The ingest pipeline strips "@s.whatsapp.net" from the JID; the automate hook
  // looks up Contact by workspaceId + phoneE164, so we must use the same bare number.
  const CONTACT_PHONE = "60123456789";
  const contactRes = await request.post(
    `http://localhost:3000/api/workspaces/${slug}/contacts`,
    {
      headers: { cookie: cookieHeader },
      data: { phoneE164: CONTACT_PHONE, name: "Aisha" },
    }
  );
  expect(contactRes.ok()).toBe(true);
  const { contact } = await contactRes.json();
  expect(contact.id).toBeTruthy();

  // ── 5. Create chatbot + keyword trigger with action chain ────────────────────
  const cbRes = await request.post(
    `http://localhost:3000/api/workspaces/${slug}/chatbots`,
    {
      headers: { cookie: cookieHeader },
      data: { instanceId: instance.id, enabled: true, fallbackProvider: "none" },
    }
  );
  expect(cbRes.ok()).toBe(true);
  const { chatbot } = await cbRes.json();

  const trigRes = await request.post(
    `http://localhost:3000/api/workspaces/${slug}/chatbots/${chatbot.id}/triggers`,
    {
      headers: { cookie: cookieHeader },
      data: {
        keyword: "vip",
        matchType: "exact",
        response: "Welcome VIP!",
        actions: [
          { type: "add_labels", labelIds: [label.id] },
          { type: "send_text", text: "Hi {{contact.name}}" },
        ],
      },
    }
  );
  expect(trigRes.ok()).toBe(true);

  // ── 6. POST inbound webhook to the ingest service ───────────────────────────
  await request.post(
    `http://localhost:4000/whatsapp/webhook/${instance.workspaceId}/${instance.id}`,
    {
      data: {
        event: "messages.upsert",
        data: {
          key: {
            id: "EVO-INBOUND-CHAIN-001",
            remoteJid: `${CONTACT_PHONE}@s.whatsapp.net`,
            fromMe: false,
          },
          pushName: "Aisha",
          message: { conversation: "vip" },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
    }
  );

  // ── 7. Assert: outbound send_text captured by stub ───────────────────────────
  // Poll up to 5 s for the automate round-trip (same as automation.spec.ts)
  for (let i = 0; i < 20; i++) {
    if (sentMessages.length > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(sentMessages.find((m) => m.text.includes("Hi"))).toBeTruthy();

  // ── 8. Assert: ContactLabel row exists for VIP ───────────────────────────────
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `http://localhost:3000/api/workspaces/${slug}/contacts?q=${CONTACT_PHONE}`,
          { headers: { cookie: cookieHeader } }
        );
        const { contacts } = await res.json();
        const c = contacts?.find((x: any) => x.id === contact.id);
        return (
          c?.labels?.some(
            (l: any) => l.labelId === label.id || l.label?.name === "VIP"
          ) ?? false
        );
      },
      { timeout: 6000, intervals: [300] }
    )
    .toBe(true);

  // ── 9. Assert: a Conversation row exists for this contact phone ──────────────
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `http://localhost:3000/api/workspaces/${slug}/conversations`,
          { headers: { cookie: cookieHeader } }
        );
        const { conversations } = await res.json();
        return conversations?.some((cv: any) => cv.contactPhone === CONTACT_PHONE) ?? false;
      },
      { timeout: 6000, intervals: [300] }
    )
    .toBe(true);

  await ctx.close();
});
