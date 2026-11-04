import { test, expect } from "@playwright/test";
import http from "node:http";
import { freshEmail, resetDb } from "./playwright.helpers";

let stub: http.Server;
const PORT = 18080;

test.beforeAll(async () => {
  resetDb();

  stub = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/instance/create" && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({
        instance: { instanceName: "stub-instance" },
        hash: "stub-key",
        qrcode: { base64: "data:image/png;base64,iVBORw0KGgo=" },
      }));
      return;
    }
    if (req.url?.startsWith("/instance/connect/") && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ base64: "data:image/png;base64,iVBORw0KGgo=", code: "stub" }));
      return;
    }
    if (req.url?.startsWith("/instance/connectionState/") && req.method === "GET") {
      res.writeHead(200);
      res.end(JSON.stringify({ instance: { instanceName: "stub-instance", state: "open" } }));
      return;
    }
    if (req.url?.startsWith("/instance/delete/") && req.method === "DELETE") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url?.startsWith("/message/sendText/") && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ key: { id: "MSG_STUB_1" }, status: "PENDING" }));
      return;
    }
    if (req.url?.startsWith("/chat/sendPresence/") && req.method === "POST") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => stub.listen(PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

test("admin creates instance, sees QR, sends a test message, deletes the instance", async ({ browser }) => {
  const ownerEmail = freshEmail("owner");
  const pw = "hunter22hunter";

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // sign up + onboard
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(ownerEmail);
  await page.getByPlaceholder("Password").fill(pw);
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Plan 1 Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");

  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // go to instances → new
  await page.goto(`/${slug}/instances`);
  await page.getByRole("link", { name: /New instance/i }).click();
  await page.getByPlaceholder(/Sales line/).fill("Sales WA");
  await page.getByRole("button", { name: /Create instance/i }).click();

  // pair page should render the stub QR
  await page.waitForURL(/\/instances\/[^/]+\/pair$/);
  await expect(page.locator("img[alt='QR code']")).toBeVisible({ timeout: 10000 });

  // state should poll to "open"
  await expect(page.getByText(/State:\s*open/)).toBeVisible({ timeout: 10000 });

  // navigate to the detail page
  const pairUrl = page.url();
  const instanceId = pairUrl.match(/\/instances\/([^/]+)\/pair/)![1];
  await page.goto(`/${slug}/instances/${instanceId}/test-send`);
  await page.getByPlaceholder("60123456789").fill("60123456789");
  await page.getByRole("textbox", { name: /Message/i }).fill("hello from e2e");
  await page.getByRole("button", { name: /Send/i }).click();
  await expect(page.getByText(/Sent/i)).toBeVisible({ timeout: 5000 });

  // delete the instance
  page.on("dialog", (d) => d.accept());
  await page.goto(`/${slug}/instances/${instanceId}`);
  await page.getByRole("button", { name: /Delete instance/i }).click();
  await page.waitForURL(`**/${slug}/instances`);
});
