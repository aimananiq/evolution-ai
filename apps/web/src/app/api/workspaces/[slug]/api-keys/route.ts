import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError } from "@evo/shared";

const schema = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.string()).optional() });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const keys = await db.apiKey.findMany({
      where: { revokedAt: null },
      select: { id: true, name: true, scopes: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ keys });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const token = "ek_" + randomBytes(24).toString("base64url");
    const hashed = await argon2.hash(token, { type: argon2.argon2id });
    const db = tenantClient(workspace.id);
    const key = await db.apiKey.create({
      data: {
        name: parsed.data.name,
        hashedKey: hashed,
        scopes: parsed.data.scopes ?? [],
        createdByUserId: userId,
      } as any,
    });
    await writeAudit({
      workspaceId: workspace.id, userId,
      action: "apikey.created", target: `apikey:${key.id}`,
    });
    return NextResponse.json({ id: key.id, name: key.name, token }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
