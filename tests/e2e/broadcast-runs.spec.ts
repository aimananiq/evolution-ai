import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18082;

test.beforeAll(async () => {
  resetDb();
  stub = http.createServer((req, res) => {
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
      res.writeHead(200); res.end(JSON.stringify({ key: { id: `EVO-${Math.random().toString(36).slice(2,8)}` }, status: "PENDING" })); return;
    }
    if (req.url?.startsWith("/chat/sendPresence/")) {
      res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
    }
    if (req.url?.startsWith("/chat/whatsappNumbers/")) {
      res.writeHead(200); res.end(JSON.stringify([])); return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => stub.listen(STUB_PORT, r));
});

test.afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
});

test("admin creates contacts → list → template → broadcast → sees sent counts", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("bcast");
  const pw = "hunter22hunter";

  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(pw);
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Broadcast Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Bcast WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);

  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const insts = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances`, { headers: { cookie: cookieHeader } });
  const { instances } = await insts.json();
  const instanceId = instances[0].id;

  await request.post(`http://localhost:3000/api/workspaces/${slug}/contacts`, {
    headers: { cookie: cookieHeader },
    data: { phoneE164: "60111111111", name: "Aisha" },
  });
  await request.post(`http://localhost:3000/api/workspaces/${slug}/contacts`, {
    headers: { cookie: cookieHeader },
    data: { phoneE164: "60222222222", name: "Daniel" },
  });
  const contactsRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/contacts`, { headers: { cookie: cookieHeader } });
  const { contacts } = await contactsRes.json();
  const contactIds = contacts.map((c: any) => c.id);

  const listRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/lists`, {
    headers: { cookie: cookieHeader }, data: { name: "Test list" },
  });
  const { list } = await listRes.json();
  await request.post(`http://localhost:3000/api/workspaces/${slug}/lists/${list.id}/members`, {
    headers: { cookie: cookieHeader }, data: { contactIds },
  });

  const tplRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/templates`, {
    headers: { cookie: cookieHeader }, data: { name: "Hello", body: "hi from e2e" },
  });
  const { template } = await tplRes.json();

  const broadcastRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/broadcasts`, {
    headers: { cookie: cookieHeader },
    data: {
      name: "First broadcast", instanceId, listId: list.id, templateId: template.id,
      jitterMinMs: 0, jitterMaxMs: 100,
    },
  });
  expect(broadcastRes.ok()).toBe(true);
  const { broadcast } = await broadcastRes.json();

  await request.post(`http://localhost:3000/api/workspaces/${slug}/broadcasts/${broadcast.id}/start`, {
    headers: { cookie: cookieHeader },
  });

  let totals = { queued: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const detailRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/broadcasts/${broadcast.id}`, { headers: { cookie: cookieHeader } });
    const data = await detailRes.json();
    totals = data.totals;
    if (totals.sent >= 2) break;
  }
  expect(totals.sent).toBeGreaterThanOrEqual(2);
});
