import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const STUB_PORT = 18084;

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
      res.writeHead(200); res.end(JSON.stringify({ key: { id: `EVO-${Math.random()}` }, status: "PENDING" })); return;
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

test("admin creates warmer profile, starts run, sees events", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = freshEmail("warm");

  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Warm Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  await page.goto(`/${slug}/instances/new`);
  await page.getByPlaceholder(/Sales line/).fill("Warm WA");
  await page.getByRole("button", { name: /Create instance/i }).click();
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);

  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const insts = await request.get(`http://localhost:3000/api/workspaces/${slug}/instances`, { headers: { cookie: cookieHeader } });
  const { instances } = await insts.json();
  const instanceId = instances[0].id;

  const profileRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/warmer/profiles`, {
    headers: { cookie: cookieHeader },
    data: {
      name: "Test profile",
      config: {
        mode: "pair",
        participatingInstanceIds: [instanceId],
        outboundPartners: [{ number: "60134", label: "main" }],
        schedule: { startHour: 0, endHour: 24, skipProbability: 0 },
        pacing: { typingPerCharMs: 100, typingMinMs: 1000, typingMaxMs: 2000, replyMinMs: 0, replyMaxMs: 100, minTurnsPerConversation: 3, maxTurnsPerConversation: 5 },
        timeOfDayWeights: new Array(24).fill(1),
        dayOfWeekWeights: new Array(7).fill(1),
      },
    },
  });
  expect(profileRes.ok()).toBe(true);
  const { profile } = await profileRes.json();

  const startRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/warmer/profiles/${profile.id}/start`, {
    headers: { cookie: cookieHeader },
  });
  expect(startRes.ok()).toBe(true);

  const eventsRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/warmer/profiles/${profile.id}/events`, {
    headers: { cookie: cookieHeader },
  });
  expect(eventsRes.ok()).toBe(true);
  const { events } = await eventsRes.json();
  expect(Array.isArray(events)).toBe(true);

  const stopRes = await request.post(`http://localhost:3000/api/workspaces/${slug}/warmer/profiles/${profile.id}/stop`, {
    headers: { cookie: cookieHeader },
  });
  expect(stopRes.ok()).toBe(true);
});
