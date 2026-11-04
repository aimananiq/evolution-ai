import { NextResponse } from "next/server";
import { z } from "zod";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance, type SendPayload } from "@/lib/send";
import { AppError } from "@evo/shared";

// Public send endpoint for external automations (n8n / Zapier / Make).
// Authenticate with a workspace API key: `Authorization: Bearer ek_...`.
// The instance in the URL may be its id (cuid) OR its Evolution instance name.
//
// Text:   { "to": "60123456789", "text": "Hello 👋" }
// Media:  { "to": "60123456789", "type": "image", "mediaUrl": "https://…/x.png", "caption": "…" }
//
// Field aliases are accepted so an existing Wasapbot-style body needs minimal edits:
//   number → to · message → text/caption · media_url → mediaUrl

const MEDIA_TYPES = ["image", "video", "document", "audio"] as const;

// Map the WhatsApp engine's raw delivery state to a clear status. The send call
// returns as soon as WhatsApp *accepts* the message, so the raw state is almost
// always "PENDING" — which reads like a failure but isn't. "sent" = accepted for
// delivery (ok). Real delivered/read confirmations arrive later via the
// message.status outbound webhook.
function normalizeStatus(raw?: string): "sent" | "delivered" | "read" | "failed" {
  const v = String(raw ?? "").toUpperCase();
  if (v === "READ") return "read";
  if (v === "DELIVERY_ACK" || v === "DELIVERED") return "delivered";
  if (v === "ERROR") return "failed";
  return "sent"; // PENDING / SERVER_ACK / SENT / unknown — ok:true means accepted
}

// Wasapbot-style error envelope: a self-describing body plus the matching HTTP code.
function errorResponse(code: number, message: string) {
  return NextResponse.json({ status: "error", ok: false, code, message }, { status: code });
}

const bodySchema = z
  .object({
    to: z.string().min(8),
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
      to: raw.to ?? raw.number,
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
        ? { type: "text", to: data.to, text: data.text!, userId }
        : {
            type: "media",
            to: data.to,
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
      // Return a compact result — the engine's full echo (media hashes, thumbnails,
      // byte arrays) is huge and unhelpful for automations like n8n.
      return NextResponse.json({
        status: "success",
        ok: true,
        messageId: result?.key?.id ?? null,
        to: data.to,
        delivery: normalizeStatus(result?.status), // "sent" once accepted (delivered/read arrive via webhook)
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
