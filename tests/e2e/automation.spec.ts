import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18083;
const sentMessages: string[] = [];

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub" }, hash: "stub-key" })); return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub", state: "open" } })); return;
    }
    if (req.url?.startsWith("/webhook/set/")) {
      res.writeHead(200); res.end(JSON.stringify({ webhook: { enabled: true } })); return;
    }
    if (req.url?.startsWith("/message/sendText/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      sentMessages.push(body.text ?? "");
      res.writeHead(200); res.end(JSON.stringify({ key: { id: `EVO-${sentMessages.length}` }, status: "PENDING" }));
      return;
    }
    if (req.url?.startsWith("/chat/sendPresence/")) {
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => stub.listen(STUB_PORT, r));
});

test.afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});

test("admin configures chatbot keyword trigger; inbound webhook fires auto-reply", async ({ browser, request }) => {
  sentMessages.length = 0;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("auto");

  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Auto Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Auto WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);

  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const insts = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances`, { headers: { cookie: cookieHeader } });
  const { instances } = await insts.json();
  const instance = instances[0];

  // Create chatbot via API
  const cbRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/chatbots`, {
    headers: { cookie: cookieHeader },
    data: { instanceId: instance.id, enabled: true, fallbackProvider: "none" },
  });
  expect(cbRes.ok()).toBe(true);
  const { chatbot } = await cbRes.json();

  await request.post(`http://localhost:3000/api/workspaces/${slug}/chatbots/${chatbot.id}/triggers`, {
    headers: { cookie: cookieHeader },
    data: { keyword: "menu", matchType: "exact", response: "Here is our menu: 1) coffee 2) tea" },
  });

  // POST inbound webhook to the ingest service
  await request.post(`http://localhost:4000/whatsapp/webhook/${instance.workspaceId}/${instance.id}`, {
    data: {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-INBOUND-AUTO", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "menu" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });

  // Wait up to 5s for the automate call to round-trip
  for (let i = 0; i < 20; i++) {
    if (sentMessages.length > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(sentMessages.find((m) => m.includes("menu"))).toBeTruthy();
});
