import { NextResponse } from "next/server";
import { prisma } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { requireUnder } from "@evo/limits";
import { AppError } from "@evo/shared";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const wp = await prisma.workspacePlan.findUnique({
      where: { workspaceId: workspace.id },
      include: { plan: true },
    });
    const [contact, instance, messageMonthly] = await Promise.all([
      requireUnder(workspace.id, "contact"),
      requireUnder(workspace.id, "instance"),
      requireUnder(workspace.id, "messageMonthly"),
    ]);
    return NextResponse.json({
      plan: wp?.plan ?? null,
      since: wp?.since ?? null,
      usage: { contact, instance, messageMonthly },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
