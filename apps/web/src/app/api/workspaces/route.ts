import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@evo/db";
import { auth } from "@/lib/auth";
import { toSlug } from "@evo/shared";

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().default("Asia/Kuala_Lumpur"),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
  }

  let slug = toSlug(parsed.data.name);
  let attempt = 0;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${toSlug(parsed.data.name)}-${attempt}`;
    if (attempt > 50) {
      return NextResponse.json({ error: "SLUG_UNAVAILABLE" }, { status: 409 });
    }
  }

  const freePlan = await prisma.plan.findUnique({ where: { kind: "free" } });

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: {
        name: parsed.data.name,
        slug,
        timezone: parsed.data.timezone,
        members: { create: { userId: session.user.id, role: "Owner" } },
      },
    });
    if (freePlan) {
      await tx.workspacePlan.create({
        data: { workspaceId: created.id, planId: freePlan.id },
      });
    }
    return created;
  });

  return NextResponse.json({ workspace }, { status: 201 });
}
