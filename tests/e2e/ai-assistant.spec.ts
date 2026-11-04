/**
 * E2E — AI Assistant flow
 *
 * Journey:
 *  1. Sign up + create workspace
 *  2. Seed a connected instance directly via Prisma (connectionState "open")
 *     — same pattern as new-features.spec.ts; no Evolution stub needed.
 *  3. Navigate to AI Assistants → + New Assistant
 *  4. Step 1 (Personality): fill name "E2E Helper", pick "Professional" voice, Next
 *  5. Step 2 (Knowledge): add a Q&A (question + answer), Next
 *  6. Step 3 (Try it): send a message; accept either a real reply or a graceful
 *     error notice (AI_ERROR / NO_AI_CONFIG / UNKNOWN) — the UI must not crash.
 *  7. Step 4 (Go live): instance is already seeded; select it, click Turn on.
 *  8. Assert assistant home shows "Live on …"
 *  9. Assert via API that the Chatbot row has enabled=true, a topicId, and
 *     fallbackProvider !== "none".
 * 10. Toggle Turn off; assert status shows "Draft".
 *
 * Port: 18086 — one above inbound-integrations (18085); no conflict.
 */

import { test, expect } from "@playwright/test";
import { prisma } from "@evo/db";
import { freshEmail, resetDb } from "./playwright.helpers";

test.beforeAll(() => {
  resetDb();
});

test("AI Assistant create → knowledge → test → go-live → off", async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ── 1. Sign up & create workspace ──────────────────────────────────────────
  const email = freshEmail("assistant");
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill("hunter22hunter");
  await page.getByRole("button", { name: /Create account/i }).click();

  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("Assistant Co");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");

  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];

  // ── 2. Seed a connected instance directly via Prisma ───────────────────────
  // (pattern from new-features.spec.ts — avoids needing a running Evolution stub)
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const instance = await prisma.instance.create({
    data: {
      workspaceId: workspace.id,
      label: "E2E Line",
      evolutionInstanceName: "evo-assistant-e2e-" + Date.now(),
      evolutionApiKey: "stub-key",
      connectionState: "open",
      phoneNumber: "60100000001",
    },
  });

  // ── 3. Navigate to AI Assistants ───────────────────────────────────────────
  await page.goto(`/${slug}/assistants`);
  await expect(page.getByRole("heading", { name: /AI Assistants/i })).toBeVisible();

  // Click + New Assistant
  await page.getByRole("link", { name: /\+ New Assistant/i }).click();
  await page.waitForURL(`**/${slug}/assistants/new`);

  // ── 4. Step 1 — Personality ────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: /Name your assistant/i })).toBeVisible();

  await page.getByLabel("Name").fill("E2E Helper");

  // Pick "Professional" voice (rendered as a pill button with that text)
  await page.getByRole("button", { name: "Professional" }).click();

  // Click Next (disabled until name is filled; it's now filled)
  await page.getByRole("button", { name: /^Next$/i }).click();

  // ── 5. Step 2 — Knowledge ──────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: /Knowledge/i })).toBeVisible({ timeout: 10000 });

  // Fill the Q&A section
  await page.getByLabel("Question").fill("What are your opening hours?");
  // The answer textarea is labeled "Answer"
  await page.getByLabel("Answer").fill("We are open Monday to Friday, 9 am to 6 pm.");

  // Click "Add Q&A"
  await page.getByRole("button", { name: /Add Q&A/i }).click();

  // Wait for the item to appear in the "Added so far" list
  await expect(page.getByText("What are your opening hours?")).toBeVisible({ timeout: 10000 });

  // Next to Try it
  await page.getByRole("button", { name: /^Next$/i }).click();

  // ── 6. Step 3 — Try it ─────────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: /Try it/i })).toBeVisible({ timeout: 10000 });

  // Type a test message and send it
  await page.getByPlaceholder("Type a message…").fill("Hello, are you there?");
  await page.getByRole("button", { name: /^Send$/i }).click();

  // Accept either a real AI reply bubble OR one of the graceful error notices
  // emitted by TryItStep when no AI provider is configured or the call fails.
  // Any assistant-side bubble or error label satisfies this check.
  const replyOrError = page.locator([
    // A reply bubble rendered by the assistant role
    "[style*='bubble-in']",
    // The inline error labels rendered below each error bubble
    "text=AI provider error",
    "text=No AI configured",
    "text=Error",
    // The full error bubble texts (fallback)
    "text=The AI provider had a problem",
    "text=Set up your AI provider",
    "text=Something went wrong",
  ].join(", "));

  await expect(replyOrError.first()).toBeVisible({ timeout: 15000 });

  // Proceed to Go live (the "Next" button lives in TryItStep navigation)
  await page.getByRole("button", { name: /^Next$/i }).click();

  // ── 7. Step 4 — Go live ────────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: /Turn it on for a WhatsApp number/i })).toBeVisible({ timeout: 10000 });

  // The seeded instance "E2E Line" should appear in the select
  const instanceSelect = page.locator("#instance-select");
  await expect(instanceSelect).toBeVisible({ timeout: 5000 });

  // Select our seeded instance (it may already be selected as the first option)
  await instanceSelect.selectOption({ label: "E2E Line" });

  // Click "Turn on — start replying now"
  await page.getByRole("button", { name: /Turn on/i }).click();

  // Wizard navigates to the assistant home page after activation
  await page.waitForURL(`**/${slug}/assistants/**`, { timeout: 15000 });
  // Exclude the /new path (shouldn't happen but be explicit)
  await expect(page.url()).not.toContain("/new");

  // ── 8. Assert "Live on …" status on assistant home ─────────────────────────
  // AssistantHome renders: <StatusPill tone="success">Live on {liveOn}</StatusPill>
  await expect(page.getByText(/Live on/i)).toBeVisible({ timeout: 10000 });

  // ── 9. API assertion: chatbot row has enabled=true, topicId, fallbackProvider !== "none" ──
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const assistantsRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/assistants`, {
    headers: { cookie: cookieHeader },
  });
  expect(assistantsRes.ok()).toBe(true);
  const { assistants } = await assistantsRes.json();
  const liveAssistant = (assistants as Array<{ id: string; status: string }>).find(
    (a) => a.status === "live",
  );
  expect(liveAssistant).toBeTruthy();

  // Verify the chatbot row via the chatbots API
  const chatbotsRes = await request.get(`http://localhost:3000/api/workspaces/${slug}/chatbots`, {
    headers: { cookie: cookieHeader },
  });
  expect(chatbotsRes.ok()).toBe(true);
  const { chatbots } = await chatbotsRes.json();
  const activatedBot = (
    chatbots as Array<{
      enabled: boolean;
      topicId: string | null;
      fallbackProvider: string;
      instanceId: string;
    }>
  ).find((cb) => cb.instanceId === instance.id);

  expect(activatedBot).toBeTruthy();
  expect(activatedBot!.enabled).toBe(true);
  expect(activatedBot!.topicId).toBeTruthy();
  expect(activatedBot!.fallbackProvider).not.toBe("none");

  // ── 10. Turn off → assert "Draft" ──────────────────────────────────────────
  // AssistantHome shows a "Turn off" button when live
  await page.getByRole("button", { name: /Turn off/i }).click();

  // After router.refresh() the page re-renders; the status pill should show Draft
  await expect(page.getByText("Draft")).toBeVisible({ timeout: 10000 });
});
