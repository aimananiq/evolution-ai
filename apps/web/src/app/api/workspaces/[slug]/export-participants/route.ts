import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { EvolutionClient, GroupsApi } from "@evo/evolution-client";
import { requireMember } from "@/lib/tenancy";
import { revealSecret } from "@evo/crypto";
import { AppError, NotFoundError } from "@evo/shared";

function toCsv(rows: Array<Record<string, string>>): string {
  if (!rows.length) return "phone,name\n";
  const headers = Object.keys(rows[0]!);
  const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n") + "\n";
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? "contacts";
  try {
    const { workspace } = await requireMember(slug, "Viewer");
    const db = tenantClient(workspace.id);

    let rows: Array<Record<string, string>> = [];
    let filename = "contacts.csv";

    if (source === "group") {
      const instanceId = url.searchParams.get("instanceId");
      const groupJid = url.searchParams.get("groupJid");
      if (!instanceId || !groupJid) return NextResponse.json({ error: "instanceId+groupJid required" }, { status: 400 });
      // Accept either the app's instance id (cuid) or the Evolution instance name.
      const instance =
        (await db.instance.findUnique({ where: { id: instanceId } })) ??
        (await db.instance.findFirst({ where: { evolutionInstanceName: instanceId } }));
      if (!instance) throw new NotFoundError("Instance not found");
      const base = process.env.EVOLUTION_BASE_URL;
      if (!base) return NextResponse.json({ error: "EVOLUTION_NOT_CONFIGURED" }, { status: 500 });
      const api = new GroupsApi(new EvolutionClient({ baseUrl: base, apiKey: await revealSecret(instance.evolutionApiKey) }));
      const parts = await api.participants(instance.evolutionInstanceName, groupJid);
      rows = parts.map((p) => {
        // Prefer the real phone-number JID (Baileys 7 `phoneNumber`, or our patched `jid`);
        // fall back to the LID only when the instance can't resolve the number.
        const phoneJid = p.phoneNumber ?? p.jid ?? (p.id.includes("@s.whatsapp") ? p.id : undefined);
        return {
          phone: (phoneJid ?? "").replace(/@.*/, ""),
          lid: (p.lid ?? (p.id.includes("@lid") ? p.id : "")).replace(/@.*/, ""),
          admin: p.admin ?? "",
        };
      });
      filename = "group-participants.csv";
    } else if (source === "lid") {
      // The captured phone↔LID map: everyone who has messaged this instance, with
      // their WhatsApp username LID (from inbound), so phone-hidden group members
      // can be resolved by cross-referencing the LID column.
      const instanceId = url.searchParams.get("instanceId");
      if (!instanceId) return NextResponse.json({ error: "instanceId required" }, { status: 400 });
      const instance =
        (await db.instance.findUnique({ where: { id: instanceId } })) ??
        (await db.instance.findFirst({ where: { evolutionInstanceName: instanceId } }));
      if (!instance) throw new NotFoundError("Instance not found");
      const convs = await db.conversation.findMany({
        where: { instanceId: instance.id },
        select: { contactPhone: true, contactPhoneReal: true, contactLid: true, contactName: true, lastMessageAt: true },
        orderBy: { lastMessageAt: "desc" },
        take: 100000,
      });
      rows = convs.map((c) => ({
        phone: c.contactPhoneReal ?? c.contactPhone,
        lid: c.contactLid ?? "",
        name: c.contactName ?? "",
        last_contact: c.lastMessageAt.toISOString(),
      }));
      filename = "lid-map.csv";
    } else {
      const contacts = await db.contact.findMany({ select: { phoneE164: true, name: true }, take: 100000 });
      rows = contacts.map((c) => ({ phone: c.phoneE164, name: c.name ?? "" }));
    }

    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 502 });
  }
}
