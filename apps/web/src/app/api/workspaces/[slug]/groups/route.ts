import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, GroupsApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError } from "@evo/shared";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    // Accept either the app's instance id (cuid) or the Evolution instance name.
    const instance =
      (await db.instance.findUnique({ where: { id: instanceId } })) ??
      (await db.instance.findFirst({ where: { evolutionInstanceName: instanceId } }));
    if (!instance) return NextResponse.json({ error: "instance not found" }, { status: 404 });
    const base = process.env.EVOLUTION_BASE_URL;
    if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });

    const client = new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey), timeoutMs: 20_000 });
    const name = instance.evolutionInstanceName;

    // Fetching groups needs a LIVE WhatsApp session. Do a fast state check first
    // so a disconnected number returns a clear message instead of a slow 502.
    try {
      const st = await client.request<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${encodeURIComponent(name)}`);
      const state = st?.instance?.state;
      if (state && state !== "open") {
        // keep our record honest while we're here
        if (instance.connectionState !== state) {
          await db.instance.update({ where: { id: instance.id }, data: { connectionState: state as never } }).catch(() => {});
        }
        return NextResponse.json({ groups: [], error: "INSTANCE_NOT_CONNECTED" });
      }
    } catch {
      /* state probe failed — fall through and still attempt the group fetch */
    }

    try {
      const groups = await new GroupsApi(client).fetchAllGroups(name, false);
      return NextResponse.json({ groups });
    } catch {
      // Always return parseable JSON (never let it bubble to an HTML 502 page).
      return NextResponse.json({ groups: [], error: "GROUP_FETCH_FAILED" });
    }
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
