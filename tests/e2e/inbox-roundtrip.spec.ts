import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18081;
const INGEST_BASE = "http://localhost:4000";

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub" }, hash: "stub-key", qrcode: { base64: "data:image/png;base64,iVBORw0KGgo=" } }));
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/")) {
      res.writeHead(200); res.end(JSON.stringify({ instance: { instanceName: "stub", state: "open" } })); return;
    }
    if (req.url?.startsWith("/webhook/set/")) {
      res.writeHead(200); res.end(JSON.stringify({ webhook: { enabled: true } })); return;
    }
    if (req.url?.startsWith("/message/sendText/")) {
      res.writeHead(200); res.end(JSON.stringify({ key: { id: "EVO-REPLY" }, status: "PENDING" })); return;
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

test("inbound webhook surfaces in inbox; reply sends through chokepoint", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const email = freshEmail("inbox");
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Inbox Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Inbox WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);
  const instanceId = page.url().match(/instances\/([^/]+)\/pair/)![1];

  const resp = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances/${instanceId}`, {
    headers: { cookie: await ctx.cookies().then((cs) => cs.map((c) => `${c.name}=${c.value}`).join("; ")) },
  });
  const { instance } = await resp.json();
  const workspaceId = instance.workspaceId;

  const webhookRes = await request.post(`${INGEST_BASE}/whatsapp/webhook/${workspaceId}/${instanceId}`, {
    data: {
      event: "messages.upsert",
      data: {
        key: { id: "EVO-INBOUND-1", remoteJid: "60123456789@s.whatsapp.net", fromMe: false },
        pushName: "Aisha",
        message: { conversation: "hello from outside" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    },
  });
  expect(webhookRes.ok()).toBe(true);

  await page.goto(`/${slug}/inbox`);
  await expect(page.getByText("Aisha")).toBeVisible({ timeout: 10000 });
  await page.getByText("Aisha").click();
  await expect(page.getByText("hello from outside")).toBeVisible({ timeout: 5000 });

  await page.getByPlaceholder("Type a message").fill("hi back");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText("hi back")).toBeVisible({ timeout: 5000 });
});
