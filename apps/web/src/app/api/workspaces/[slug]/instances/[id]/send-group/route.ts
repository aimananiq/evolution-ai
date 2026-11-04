import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance, type SendPayload } from "@/lib/send";
import { AppError } from "@evo/shared";

// Public group-send endpoint for external automations (n8n / Zapier / Make).
// The Wasapbot `/send_group` equivalent — same contract as `/send`, but the
// recipient is a WhatsApp **group** instead of a phone number.
// Authenticate with a workspace API key: `Authorization: Bearer ek_...`.
// The instance in the URL may be its id (cuid) OR its Evolution instance name.
//
// Text:   { "groupId": "120363012345678901@g.us", "message": "Hello group 👋" }
// Media:  { "groupId": "120363…@g.us", "type": "image", "media_url": "https://…/x.png", "message": "…" }
//
// Find a group's id with GET /groups?instanceId={id}. Field aliases are accepted
// so a Wasapbot-style body needs minimal edits:
//   group_id / to → groupId · message → text/caption · media_url → mediaUrl

const MEDIA_TYPES = ["image", "video", "document", "audio"] as const;

// A group is addressed by its JID: "<id>@g.us". Accept the full JID or just the
// numeric id (with or without a legacy hyphen) and normalise to a clean JID.
function toGroupJid(raw: string): string {
  const s = String(raw).trim();
  const local = s.includes("@") ? s.slice(0, s.indexOf("@")) : s;
  const cleaned = local.replace(/[^0-9-]/g, "");
  return cleaned ? `${cleaned}@g.us` : "";
}

// Same status mapping as /send: the engine returns as soon as WhatsApp *accepts*
// the message, so the raw state is almost always "PENDING" — which is ok, not a
// failure. Real delivered/read confirmations arrive via the message.status webhook.
function normalizeStatus(raw?: string): "sent" | "delivered" | "read" | "failed" {
  const v = String(raw ?? "").toUpperCase();
  if (v === "READ") return "read";
  if (v === "DELIVERY_ACK" || v === "DELIVERED") return "delivered";
  if (v === "ERROR") return "failed";
  return "sent";
}

function errorResponse(code: number, message: string) {
  return NextResponse.json({ status: "error", ok: false, code, message }, { status: code });
}

const bodySchema = z
  .object({
    groupId: z.string().min(1),
    type: z.enum(["text", ...MEDIA_TYPES]).default("text"),
    text: z.string().max(4000).optional(),
    mediaUrl: z.string().url().max(2000).optional(),
    fileName: z.string().max(200).optional(),
  })
  .refine((d) => (d.type === "text" ? !!d.text?.trim() : !!d.mediaUrl), {
    message: "text is required for text messages; mediaUrl is required for image/video/document/audio",
  });

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  try {
    const { workspace, userId } = await requireMember(slug, "Admin");

    // Normalise alias field names before validation.
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const normalized = {
      groupId: raw.groupId ?? raw.group_id ?? raw.groupJid ?? raw.to,
      type: raw.type ?? "text",
      text: raw.text ?? raw.caption ?? raw.message,
      mediaUrl: raw.mediaUrl ?? raw.media_url,
      fileName: raw.fileName ?? raw.file_name,
    };
    const parsed = bodySchema.safeParse(normalized);
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Invalid request body");
    }
    const data = parsed.data;

    const groupJid = toGroupJid(data.groupId);
    if (!groupJid) return errorResponse(400, "groupId must be a group JID (…@g.us) or its numeric id");

    // Resolve the instance by id (cuid) or by Evolution instance name — tenant-scoped.
    const db = tenantClient(workspace.id);
    const instance = await db.instance.findFirst({
      where: { OR: [{ id }, { evolutionInstanceName: id }] },
    });
    if (!instance) return errorResponse(404, "Instance not found");

    // Fast pre-check: a disconnected number can't send. Return a clear 409 (not a
    // 5xx — Cloudflare replaces origin 5xx with its own opaque "Bad gateway" page,
    // hiding this message from the caller). Only block when we KNOW it's not open.
    if (instance.connectionState && instance.connectionState !== "open") {
      return errorResponse(409, "This WhatsApp number is not connected. Reconnect it in Instances → scan the QR, then retry.");
    }

    const payload: SendPayload =
      data.type === "text"
        ? { type: "text", to: groupJid, text: data.text!, userId }
        : {
            type: "media",
            to: groupJid,
            mediaUrl: data.mediaUrl!,
            mediatype: data.type,
            caption: data.text?.trim() ? data.text : undefined,
            fileName: data.fileName,
            userId,
          };

    try {
      const result = (await sendViaInstance(instance.id, payload)) as {
        key?: { id?: string };
        status?: string;
      } | null;
      return NextResponse.json({
        status: "success",
        ok: true,
        messageId: result?.key?.id ?? null,
        to: groupJid,
        delivery: normalizeStatus(result?.status),
      });
    } catch (sendErr: unknown) {
      const msg = String((sendErr as Error)?.message ?? sendErr);
      if (msg.startsWith("throttled")) return errorResponse(429, "Sending too fast for this number — back off and retry.");
      // The number dropped its WhatsApp session mid-send (Evolution: "Connection
      // Closed"). Surface an actionable 409 rather than a 502 that Cloudflare hides.
      if (/connection closed|precondition required|not connected|logged out|close/i.test(msg)) {
        return errorResponse(409, "This WhatsApp number disconnected. Reconnect it in Instances → scan the QR, then retry.");
      }
      return errorResponse(502, msg);
    }
  } catch (e) {
    if (e instanceof AppError) return errorResponse(e.status, e.message || e.code);
    throw e;
  }
}
