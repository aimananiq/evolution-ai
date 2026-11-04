import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError, NotFoundError } from "@evo/shared";

const autoLabelSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(z.object({
    contains: z.string().max(200),
    labelId: z.string().min(1),
    op: z.enum(["add", "remove"]),
  })).max(50),
});

const humanTakeoverSchema = z.object({
  enabled: z.boolean(),
  triggerKeywords: z.array(z.string().max(80)).max(50).default([]),
  notifyType: z.enum(["whatsapp_number", "whatsapp_group"]).default("whatsapp_number"),
  notifyTargets: z.array(z.string().max(40)).max(50).default([]),
  agentMessageTemplate: z.string().max(2000).default(""),
  disableBotOnTakeover: z.boolean().default(true),
  userMessage: z.string().max(2000).default(""),
});

const followUpStepSchema = z.object({
  text: z.string().max(4000),
  delaySeconds: z.number().int().min(0).max(60 * 60 * 24 * 30),
  mediaAssetId: z.string().nullable().optional(),
});

const autoFollowUpSchema = z.object({
  enabled: z.boolean(),
  lastSenderFilter: z.enum(["chatbot", "customer"]).default("customer"),
  conditions: z.object({
    scheduleJson: z.unknown().optional(),
    contactGroupIds: z.array(z.string()).default([]),
    labelIds: z.array(z.string()).default([]),
    extra: z.unknown().optional(),
  }).default({ contactGroupIds: [], labelIds: [] }),
  steps: z.array(followUpStepSchema).max(20).default([]),
});

const putSchema = z.object({
  autoLabel: autoLabelSchema,
  humanTakeover: humanTakeoverSchema,
  autoFollowUp: autoFollowUpSchema,
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id }, include: { aiActionConfig: true } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    return NextResponse.json({ config: chatbot.aiActionConfig ?? null });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = putSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.findUnique({ where: { id } });
    if (!chatbot) throw new NotFoundError("Chatbot not found");
    const config = await db.aiActionConfig.upsert({
      where: { chatbotId: id },
      create: { chatbotId: id, ...parsed.data } as any,
      update: { ...parsed.data },
    });
    return NextResponse.json({ config });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
