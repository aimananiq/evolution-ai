import { sendViaInstance } from "@evo/send";

// ---- Config shapes (must match the zod schemas in the API layer) ----
export interface AutoLabelRule {
  /** substring match against the inbound text, case-insensitive; empty = always */
  contains: string;
  labelId: string;
  op: "add" | "remove";
}
export interface AutoLabelConfig { enabled: boolean; rules: AutoLabelRule[] }

export interface HumanTakeoverConfig {
  enabled: boolean;
  triggerKeywords: string[];
  notifyType: "whatsapp_number" | "whatsapp_group";
  notifyTargets: string[];
  agentMessageTemplate: string; // supports {{user_phone}}
  disableBotOnTakeover: boolean;
  userMessage: string;
}

export interface FollowUpStep { text: string; delaySeconds: number; mediaAssetId?: string | null }
export interface AutoFollowUpConfig {
  enabled: boolean;
  lastSenderFilter: "chatbot" | "customer";
  conditions: { scheduleJson?: unknown; contactGroupIds: string[]; labelIds: string[]; extra?: unknown };
  steps: FollowUpStep[];
}

export interface ActionCtx {
  workspaceId: string;
  instanceId: string;
  conversationId: string;
  contactPhone: string;
  inboundText: string;
}

export type BotLogKind =
  | "trigger_matched" | "ai_reply" | "auto_label"
  | "human_takeover" | "follow_up_sent" | "action_run";

export async function writeBotLog(
  ctx: { workspaceId: string; instanceId: string; conversationId?: string | null; contactId?: string | null },
  kind: BotLogKind,
  detail: Record<string, unknown>,
): Promise<void> {
  const { prisma } = await import("@evo/db");
  await prisma.botUserLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      instanceId: ctx.instanceId,
      conversationId: ctx.conversationId ?? null,
      contactId: ctx.contactId ?? null,
      kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: detail as any,
    },
  });
}

/** Evaluate auto-label rules against the inbound message and upsert ContactLabel. */
export async function applyAutoLabel(ctx: ActionCtx, cfg: AutoLabelConfig): Promise<void> {
  if (!cfg.enabled || cfg.rules.length === 0) return;
  const { prisma } = await import("@evo/db");
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  if (!contact) return;

  const text = ctx.inboundText.toLowerCase();
  const applied: Array<{ labelId: string; op: "add" | "remove" }> = [];
  for (const rule of cfg.rules) {
    const needle = (rule.contains ?? "").toLowerCase();
    if (needle && !text.includes(needle)) continue;
    if (rule.op === "add") {
      await prisma.contactLabel.upsert({
        where: { contactId_labelId: { contactId: contact.id, labelId: rule.labelId } },
        create: { contactId: contact.id, labelId: rule.labelId },
        update: {},
      });
    } else {
      await prisma.contactLabel.deleteMany({ where: { contactId: contact.id, labelId: rule.labelId } });
    }
    applied.push({ labelId: rule.labelId, op: rule.op });
  }
  if (applied.length) {
    await writeBotLog(
      { workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, conversationId: ctx.conversationId, contactId: contact.id },
      "auto_label",
      { applied },
    );
  }
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => k.trim() && t.includes(k.toLowerCase().trim()));
}

/** Returns true if a human takeover was triggered (caller must then stop bot replies). */
export async function detectAndApplyTakeover(ctx: ActionCtx, cfg: HumanTakeoverConfig): Promise<boolean> {
  if (!cfg.enabled) return false;
  if (!matchesAnyKeyword(ctx.inboundText, cfg.triggerKeywords ?? [])) return false;

  const { prisma } = await import("@evo/db");

  if (cfg.disableBotOnTakeover) {
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { botPaused: true, botPausedReason: "human_takeover" },
    });
  }

  // Notify agent(s)/group.
  const agentText = (cfg.agentMessageTemplate ?? "").replaceAll("{{user_phone}}", ctx.contactPhone);
  for (const target of cfg.notifyTargets ?? []) {
    try {
      await sendViaInstance(ctx.instanceId, { type: "text", to: target, text: agentText, userId: null }, { origin: "chatbot" });
    } catch { /* notification best-effort */ }
  }

  // Acknowledge the customer.
  if (cfg.userMessage?.trim()) {
    try {
      await sendViaInstance(ctx.instanceId, { type: "text", to: ctx.contactPhone, text: cfg.userMessage, userId: null }, { origin: "chatbot" });
    } catch { /* best-effort */ }
  }

  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  await writeBotLog(
    { workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, conversationId: ctx.conversationId, contactId: contact?.id ?? null },
    "human_takeover",
    { notifyType: cfg.notifyType, notifiedTargets: cfg.notifyTargets, botPaused: cfg.disableBotOnTakeover },
  );
  return true;
}

const FOLLOWUP_CAMPAIGN_PREFIX = "__followup__";

/** Enrol the contact into the chatbot's follow-up sequence if the last-sender gate passes. */
export async function enrolFollowUp(
  ctx: ActionCtx,
  chatbotId: string,
  cfg: AutoFollowUpConfig,
  lastSender: "chatbot" | "customer",
): Promise<boolean> {
  if (!cfg.enabled || cfg.steps.length === 0) return false;
  if (cfg.lastSenderFilter !== lastSender) return false;

  const { prisma } = await import("@evo/db");
  const contact = await prisma.contact.findUnique({
    where: { workspaceId_phoneE164: { workspaceId: ctx.workspaceId, phoneE164: ctx.contactPhone } },
  });
  if (!contact) return false;

  // Optional contactGroup/label gating.
  if (cfg.conditions?.labelIds?.length) {
    const hit = await prisma.contactLabel.count({ where: { contactId: contact.id, labelId: { in: cfg.conditions.labelIds } } });
    if (hit === 0) return false;
  }

  const name = FOLLOWUP_CAMPAIGN_PREFIX + chatbotId;
  const campaign = await prisma.dripCampaign.upsert({
    where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
    create: {
      workspaceId: ctx.workspaceId, instanceId: ctx.instanceId, name,
      triggerType: "manual", active: false,
      steps: cfg.steps as unknown as object,
    },
    update: { steps: cfg.steps as unknown as object, instanceId: ctx.instanceId },
  });

  const firstDelayMs = (cfg.steps[0]!.delaySeconds ?? 0) * 1000;
  await prisma.dripEnrolment.upsert({
    where: { campaignId_contactId: { campaignId: campaign.id, contactId: contact.id } },
    create: {
      workspaceId: ctx.workspaceId, campaignId: campaign.id, contactId: contact.id,
      currentStep: 0, status: "active", nextRunAt: new Date(Date.now() + firstDelayMs),
    },
    update: {}, // already enrolled — do not reset their progress
  });
  return true;
}
