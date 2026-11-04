import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["Admin", "Agent", "Viewer"]),
});

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function newToken() {
  return randomBytes(24).toString("base64url");
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }
    const db = tenantClient(workspace.id);
    const invitation = await db.invitation.create({
      data: {
        email: parsed.data.email,
        role: parsed.data.role,
        token: newToken(),
        expiresAt: new Date(Date.now() + EXPIRY_MS),
      } as any,
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);
    const invitations = await db.invitation.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ invitations });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
