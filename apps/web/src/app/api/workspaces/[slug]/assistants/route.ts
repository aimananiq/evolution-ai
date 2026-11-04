import { NextResponse } from "next/server";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { listAssistants, connectedInstances } from "@/lib/assistant-data";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const [assistants, instances] = await Promise.all([
      listAssistants(workspace.id),
      connectedInstances(workspace.id),
    ]);
    return NextResponse.json({ assistants, instances });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
