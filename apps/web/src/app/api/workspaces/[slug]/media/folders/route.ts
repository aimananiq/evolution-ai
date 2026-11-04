import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const folders = await db.mediaFolder.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { assets: true } } },
    });
    return NextResponse.json({ folders: folders.map((f) => ({ id: f.id, name: f.name, count: f._count.assets })) });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Agent");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const db = tenantClient(workspace.id);
    const existing = await db.mediaFolder.findFirst({ where: { name: parsed.data.name } });
    if (existing) return NextResponse.json({ error: "FOLDER_EXISTS" }, { status: 409 });
    const folder = await db.mediaFolder.create({ data: { name: parsed.data.name } as any });
    return NextResponse.json({ folder: { id: folder.id, name: folder.name, count: 0 } }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
