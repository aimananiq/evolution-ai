import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { tenantClient } from "@evo/db";
import { EvolutionClient, InstanceApi } from "@evo/evolution-client";
import { encryptSecret } from "@evo/crypto";
import { requireMember } from "@/lib/tenancy";
import { writeAudit } from "@/lib/audit";
import { AppError } from "@evo/shared";

const createSchema = z.object({
  label: z.string().min(1).max(80),
});

function evolutionInstanceName(workspaceSlug: string, label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const suffix = randomBytes(4).toString("hex");
  return `${workspaceSlug}-${slug || "instance"}-${suffix}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);
    const instances = await db.instance.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ instances });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION", issues: parsed.error.flatten() }, { status: 400 });
    }

    const { requireUnder } = await import("@evo/limits");
    const limit = await requireUnder(workspace.id, "instance");
    if (!limit.allowed) {
      return NextResponse.json({ error: "PLAN_CAP_REACHED", limit }, { status: 402 });
    }

    const evolutionName = evolutionInstanceName(slug, parsed.data.label);
    const base = process.env.EVOLUTION_BASE_URL;
    const globalKey = process.env.EVOLUTION_GLOBAL_API_KEY;
    if (!base || !globalKey) {
      return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
    }
    const api = new InstanceApi(new EvolutionClient({ baseUrl: base, apiKey: globalKey }));
    const created = await api.create({ instanceName: evolutionName, qrcode: true, integration: "WHATSAPP-BAILEYS" });

    const apiKey = created.hash ?? globalKey;

    const db = tenantClient(workspace.id);
    const instance = await db.instance.create({
      data: {
        label: parsed.data.label,
        evolutionInstanceName: evolutionName,
        evolutionApiKey: await encryptSecret(apiKey),
        connectionState: "connecting",
      } as any,
    });

    const webhookBase = process.env.WEBHOOK_PUBLIC_BASE_URL;
    if (webhookBase) {
      const webhookUrl = `${webhookBase.replace(/\/$/, "")}/whatsapp/webhook/${workspace.id}/${instance.id}`;
      const { WebhookApi } = await import("@evo/evolution-client");
      const webhook = new WebhookApi(new EvolutionClient({ baseUrl: base, apiKey: apiKey }));
      const inboundSecret = process.env.WEBHOOK_INBOUND_SECRET;
      try {
        await webhook.set(evolutionName, {
          webhook: {
            enabled: true,
            url: webhookUrl,
            ...(inboundSecret ? { headers: { Authorization: `Bearer ${inboundSecret}` } } : {}),
            events: [
              "MESSAGES_UPSERT",
              "MESSAGES_UPDATE",
              "SEND_MESSAGE",
              "CONNECTION_UPDATE",
              "QRCODE_UPDATED",
              "CONTACTS_UPSERT",
              "CHATS_UPSERT",
              "PRESENCE_UPDATE",
            ],
          },
        });
      } catch (err) {
        // Webhook config is best-effort at create time. The user can re-trigger
        // it later from the instance detail page (Plan 2 deferred).
      }
    }

    await writeAudit({
      workspaceId: workspace.id,
      userId,
      action: "instance.created",
      target: `instance:${instance.id}`,
      instanceId: instance.id,
      diff: { label: parsed.data.label, evolutionInstanceName: evolutionName },
    });

    return NextResponse.json({ instance }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
