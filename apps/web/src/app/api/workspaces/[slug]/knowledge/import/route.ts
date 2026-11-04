import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { chunkDocument } from "@evo/kb";
import { AppError } from "@evo/shared";

const schema = z.object({
  baseTitle: z.string().max(120).optional(),
  text: z.string().min(1).max(100_000),
});

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const tooLarge = parsed.error.issues.some((i) => i.code === "too_big");
      return NextResponse.json({ error: tooLarge ? "TOO_LARGE" : "EMPTY" }, { status: 400 });
    }

    const { chunks, truncated } = chunkDocument(parsed.data.text, { baseTitle: parsed.data.baseTitle });
    if (chunks.length === 0) return NextResponse.json({ error: "EMPTY" }, { status: 400 });

    const db = tenantClient(workspace.id);
    await db.knowledgeSnippet.createMany({
      data: chunks.map((c) => ({ title: c.title, content: c.content, enabled: true })) as any,
    });
    return NextResponse.json({ created: chunks.length, truncated }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
