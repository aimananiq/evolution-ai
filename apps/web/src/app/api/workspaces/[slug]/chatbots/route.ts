import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const upsertSchema = z.object({
  instanceId: z.string(),
  enabled: z.boolean(),
  welcomeMessage: z.string().max(2000).optional().nullable(),
  fallbackProvider: z.enum(["none", "claude", "openai"]),
  fallbackModel: z.string().max(80).optional().nullable(),
  systemPrompt: z.string().max(4000).optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const chatbots = await db.chatbot.findMany({
      include: { instance: { select: { label: true } }, triggers: true },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ chatbots });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.fallbackProvider === "openai") {
      return NextResponse.json({ error: "PROVIDER_NOT_IMPLEMENTED", message: "OpenAI fallback is not implemented yet. Use 'claude' or 'none'." }, { status: 501 });
    }
    const db = tenantClient(workspace.id);
    const chatbot = await db.chatbot.upsert({
      where: { instanceId: parsed.data.instanceId },
      create: parsed.data as any,
      update: {
        enabled: parsed.data.enabled,
        welcomeMessage: parsed.data.welcomeMessage,
        fallbackProvider: parsed.data.fallbackProvider,
        fallbackModel: parsed.data.fallbackModel,
        systemPrompt: parsed.data.systemPrompt,
      },
    });
    return NextResponse.json({ chatbot });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
