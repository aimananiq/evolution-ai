import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { requireSuperAdmin } from "@/lib/super-admin";
import { hashPassword } from "@/lib/password";
import { AppError } from "@evo/shared";

// Super-admin provisions a tenant's OWNER LOGIN (email + password). Public
// sign-up is disabled, so this is the only way an account is created. The
// tenant names their own workspace on first sign-in via the onboarding flow
// (/onboarding -> POST /api/workspaces), which also grants them the free plan.
const bodySchema = z.object({
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    const { ownerEmail, ownerName, password } = parsed.data;

    const email = ownerEmail.trim().toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) {
      return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({ data: { email, name: ownerName, passwordHash } });

    return NextResponse.json({ user: { email: user.email, name: user.name } }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
