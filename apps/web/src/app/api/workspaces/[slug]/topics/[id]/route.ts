import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const guardrailsSchema = z.object({
  stayOnTopic: z.boolean(),
  answerOnlyFromKnowledge: z.boolean(),
  handoff: z.object({
    enabled: z.boolean(),
    triggers: z.array(z.string()),
    onUnsure: z.boolean(),
  }),
  neverSay: z.array(z.string()),
  fallbackMessage: z.string(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  personaTone: z.string().nullable().optional(),
  greeting: z.string().nullable().optional(),
  guardrails: guardrailsSchema.optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const topic = await db.chatTopic.findUnique({ where: { id } });
    if (!topic) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      topic: {
        id: topic.id,
        name: topic.name,
        personaTone: topic.personaTone,
        greeting: topic.greeting,
        guardrails: topic.guardrails,
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

async function applyUpdate(req: Request, slug: string, id: string) {
  const { workspace } = await requireMember(slug, "Admin");
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const db = tenantClient(workspace.id);
  const existing = await db.chatTopic.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.personaTone !== undefined) data.personaTone = parsed.data.personaTone;
  if (parsed.data.greeting !== undefined) data.greeting = parsed.data.greeting;
  if (parsed.data.guardrails !== undefined) data.guardrails = parsed.data.guardrails as any;

  await db.chatTopic.update({ where: { id }, data: data as any });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    return await applyUpdate(req, slug, id);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    return await applyUpdate(req, slug, id);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const existing = await db.chatTopic.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    await db.chatTopic.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
