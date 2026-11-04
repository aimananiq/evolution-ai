import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { hashPassword } from "@/lib/password";

// Public self-service sign-up is DISABLED by default (internal tool — accounts are
// provisioned by a super-admin under /admin). Set ALLOW_SIGNUP=true to re-enable.
const SIGNUP_ENABLED = process.env.ALLOW_SIGNUP === "true";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export async function POST(req: Request) {
  if (!SIGNUP_ENABLED) {
    return NextResponse.json({ error: "SIGNUP_DISABLED" }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
  }
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
  }
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    },
    select: { id: true, email: true, name: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}
