import { test, expect } from "@playwright/test";
import { freshEmail, resetDb } from "./playwright.helpers";

test.beforeAll(() => {
  resetDb();
});

test("user signs up, creates workspace, invites teammate, teammate accepts", async ({ browser }) => {
  const ownerEmail = freshEmail("owner");
  const agentEmail = freshEmail("agent");
  const pw = "hunter22hunter";

  // Owner: sign up
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await owner.goto("/sign-up");
  await owner.getByPlaceholder("Name").fill("Eman");
  await owner.getByPlaceholder("Email").fill(ownerEmail);
  await owner.getByPlaceholder("Password").fill(pw);
  await owner.getByRole("button", { name: /Create account/i }).click();

  // Onboarding: create workspace
  await owner.waitForURL("**/onboarding");
  await owner.getByPlaceholder("Workspace name").fill("St John's Clinic");
  await owner.getByRole("button", { name: /Create workspace/i }).click();

  // Dashboard
  await owner.waitForURL("**/dashboard");
  await expect(owner.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  await expect(owner.getByText("Welcome to St John's Clinic")).toBeVisible();

  // Invite agent
  const slugMatch = owner.url().match(/\/([^/]+)\/dashboard/);
  const slug = slugMatch![1];
  await owner.goto(`/${slug}/settings/members`);
  await owner.getByPlaceholder("Email").fill(agentEmail);
  await owner.locator("select").selectOption("Agent");
  await owner.getByRole("button", { name: /Invite/i }).click();

  // Read the invitation token from the DOM (rendered as <code>)
  const token = await owner.locator("code").first().textContent();
  expect(token).toBeTruthy();

  // Agent: sign up, then accept invite link
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await agent.goto("/sign-up");
  await agent.getByPlaceholder("Name").fill("Aisha");
  await agent.getByPlaceholder("Email").fill(agentEmail);
  await agent.getByPlaceholder("Password").fill(pw);
  await agent.getByRole("button", { name: /Create account/i }).click();
  await agent.waitForURL("**/onboarding");

  // Visit the invite link
  await agent.goto(`/accept-invite/${token}`);
  await agent.getByRole("button", { name: /Accept invitation/i }).click();
  await agent.waitForURL(`**/${slug}/dashboard`);
  await expect(agent.getByText("Welcome to St John's Clinic")).toBeVisible();
});
