import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { isUniqueViolation } from "@/lib/prisma-errors";

const createSchema = z.object({
  phoneE164: z.string().min(8).max(16),
  name: z.string().min(1).max(120).optional(),
  labelIds: z.array(z.string()).optional(),
});

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const search = url.searchParams.get("q")?.trim();
  const labelId = url.searchParams.get("labelId");
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phoneE164: { contains: search } },
      ];
    }
    if (labelId) {
      where.labels = { some: { labelId } };
    }
    const contacts = await db.contact.findMany({
      where,
      include: { labels: { include: { label: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ contacts });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const { requireUnder } = await import("@evo/limits");
    const limit = await requireUnder(workspace.id, "contact");
    if (!limit.allowed) {
      return NextResponse.json({ error: "PLAN_CAP_REACHED", limit }, { status: 402 });
    }
    const db = tenantClient(workspace.id);
    const contact = await db.contact.create({
      data: {
        phoneE164: parsed.data.phoneE164,
        name: parsed.data.name ?? null,
        labels: parsed.data.labelIds && parsed.data.labelIds.length
          ? { create: parsed.data.labelIds.map((labelId) => ({ labelId })) }
          : undefined,
      } as any,
    });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    if (isUniqueViolation(e)) return NextResponse.json({ error: "DUPLICATE_PHONE" }, { status: 409 });
    throw e;
  }
}
