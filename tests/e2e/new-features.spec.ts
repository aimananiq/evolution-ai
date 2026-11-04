import { test, expect } from "@playwright/test";
import { freshEmail, resetDb } from "./playwright.helpers";
import { prisma } from "@evo/db";

test.beforeAll(() => {
  resetDb();
});

test("new features: knowledge base, webhooks, number health, flow builder, agent-assist", async ({ page }) => {
  const email = freshEmail("owner");
  const pw = "hunter22hunter";

  // --- Sign up + create workspace ---
  await page.goto("/sign-up");
  await page.getByPlaceholder("Name").fill("Eman");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(pw);
  await page.getByRole("button", { name: /Create account/i }).click();
  await page.waitForURL("**/onboarding");
  await page.getByPlaceholder("Workspace name").fill("St John's Clinic");
  await page.getByRole("button", { name: /Create workspace/i }).click();
  await page.waitForURL("**/dashboard");
  const slug = page.url().match(/\/([^/]+)\/dashboard/)![1];
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });

  // ============ 1. KNOWLEDGE BASE (add + import) ============
  await page.goto(`/${slug}/settings/knowledge`);
  await expect(page.getByRole("heading", { name: /Knowledge base/i })).toBeVisible();

  // Add a single snippet
  await page.getByPlaceholder(/Title \(e.g. Opening hours\)/i).fill("Opening hours");
  await page.getByPlaceholder(/^Content$/i).fill("We are open Monday to Friday, 9am to 6pm.");
  await page.getByRole("button", { name: /^Add snippet$/i }).click();
  await expect(page.getByText("Opening hours")).toBeVisible();

  // Import a document → auto-chunk into snippets
  await page.getByPlaceholder(/Source title/i).fill("FAQ");
  await page.getByPlaceholder(/Paste your FAQ/i).fill(
    "# Refunds\nRefunds within 14 days of purchase.\n\n# Delivery\nStandard delivery is 3-5 working days.",
  );
  await page.getByRole("button", { name: /Import & split into snippets/i }).click();
  await expect(page.getByText(/Imported 2 snippets/i)).toBeVisible();
  await expect(page.getByText("Refunds", { exact: true })).toBeVisible();
  await expect(page.getByText("Delivery", { exact: true })).toBeVisible();
  const snippetCount = await prisma.knowledgeSnippet.count({ where: { workspaceId: workspace.id } });
  expect(snippetCount).toBe(3);

  // ============ 2. WEBHOOKS (create subscription, health events, delivery panel) ============
  await page.goto(`/${slug}/settings/webhooks`);
  await expect(page.getByText(/Works with n8n, Zapier, Make/i)).toBeVisible();
  // Health event opt-in is available
  await expect(page.getByText("health.at_risk")).toBeVisible();
  await page.getByPlaceholder("https://example.com/webhook").fill("https://n8n.example.com/webhook/abc");
  await page.getByRole("button", { name: /Create subscription/i }).click();
  // Signing secret shown once
  await expect(page.getByText(/Save this signing secret now/i)).toBeVisible();
  await expect(page.locator("code", { hasText: /^whsec_/ })).toBeVisible();
  // Subscription persisted + delivery panel present
  await expect(page.getByText("https://n8n.example.com/webhook/abc")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Recent deliveries/i })).toBeVisible();
  const subCount = await prisma.webhookSubscription.count({ where: { workspaceId: workspace.id } });
  expect(subCount).toBe(1);

  // ---- Seed an instance for the instance-dependent features ----
  const instance = await prisma.instance.create({
    data: {
      workspaceId: workspace.id,
      label: "Sales line",
      evolutionInstanceName: "evo-e2e-" + Date.now(),
      evolutionApiKey: "k",
      connectionState: "open",
      phoneNumber: "60123456789",
    },
  });

  // ============ 3. NUMBER HEALTH (seeded snapshot renders) ============
  await prisma.instanceHealthSnapshot.create({
    data: {
      workspaceId: workspace.id,
      instanceId: instance.id,
      date: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"),
      score: 82,
      risk: "healthy",
      metrics: {
        businessInitiatedConversations: 20,
        replyRatio: 0.5,
        failureRate: 0.05,
        outboundOnlyConversationPct: 0.3,
        disconnectCount: 0,
        capUsagePct: 0.2,
      },
    },
  });
  await page.goto(`/${slug}/health`);
  await expect(page.getByRole("heading", { name: /Number Health/i })).toBeVisible();
  await expect(page.getByText("Sales line")).toBeVisible();
  await expect(page.getByText("82")).toBeVisible();
  await expect(page.getByText(/Healthy/i)).toBeVisible();
  await expect(page.getByText(/Reply ratio/i)).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/health.png", fullPage: true });

  // ============ 4. FLOW BUILDER (seeded chatbot + trigger render as nodes) ============
  const chatbot = await prisma.chatbot.create({
    data: { workspaceId: workspace.id, instanceId: instance.id, enabled: true, fallbackProvider: "claude", systemPrompt: "You are support." },
  });
  await prisma.keywordTrigger.create({
    data: { chatbotId: chatbot.id, keyword: "hello", matchType: "contains", response: "Hi there!", actions: [] as any },
  });
  await page.goto(`/${slug}/automation/chatbot/${instance.id}/flow`);
  await expect(page.getByRole("heading", { name: /Flow builder/i })).toBeVisible();
  await expect(page.getByText(/Incoming message/i)).toBeVisible();
  await expect(page.getByText('contains "hello"')).toBeVisible();
  await expect(page.getByText(/AI reply \(Claude\)/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add trigger/i })).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/flow.png", fullPage: true });

  // ============ 5. AGENT-ASSIST (Suggest reply wires end-to-end; no key -> friendly prompt) ============
  const conv = await prisma.conversation.create({
    data: { workspaceId: workspace.id, instanceId: instance.id, contactPhone: "60111222333", contactName: "Aisha" },
  });
  await prisma.message.create({
    data: { workspaceId: workspace.id, conversationId: conv.id, direction: "inbound", type: "text", body: "What are your opening hours?", status: "delivered" },
  });

  let dialogMessage = "";
  page.once("dialog", (d) => { dialogMessage = d.message(); d.accept(); });

  await page.goto(`/${slug}/inbox/${conv.id}`);
  await expect(page.getByRole("button", { name: /Suggest reply/i })).toBeVisible();
  await page.getByRole("button", { name: /Suggest reply/i }).click();
  await expect.poll(() => dialogMessage).toContain("Claude API key");
});
