import http from "node:http";
import pino from "pino";
import { verifyBearer } from "./hmac.js";
import { normalise } from "./normalise.js";
import { persistEvent } from "./persist.js";
import { publishEvent } from "./publish.js";
import { automate } from "./automate.js";
import { handleProbeReceipt } from "./canary-receipt.js";
import { handleInbound } from "./inbound.js";
import { emitWebhook } from "@evo/webhooks";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));

async function readBody(req: http.IncomingMessage, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    if (maxBytes !== undefined && total > maxBytes) {
      req.destroy();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const inboundMatch = req.url?.match(/^\/integration_webhook\/([^/?]+)/);
  if (inboundMatch && req.method === "POST") {
    const [, token] = inboundMatch;
    const maxBytes = Number(process.env.INBOUND_MAX_BODY_BYTES ?? 262144);
    try {
      const buf = await readBody(req, maxBytes);
      let payload: unknown = {};
      if (buf.length) {
        try {
          payload = JSON.parse(buf.toString("utf8"));
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "INVALID_JSON" }));
          return;
        }
      }
      const result = await handleInbound(token!, payload);
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      if (err instanceof Error && err.message === "BODY_TOO_LARGE") {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      log.error({ err: String(err) }, "inbound integration failed");
      res.writeHead(500).end();
    }
    return;
  }

  const match = req.url?.match(/^\/whatsapp\/webhook\/([^/]+)\/([^/?]+)/);
  if (match && req.method === "POST") {
    const [, workspaceId, instanceId] = match;
    const expectedSecret = process.env.WEBHOOK_INBOUND_SECRET;
    const allowUnsafe = process.env.WEBHOOK_INBOUND_ALLOW_UNSAFE === "true";
    if (!expectedSecret && !allowUnsafe) {
      log.error("WEBHOOK_INBOUND_SECRET not set; refusing webhook (set WEBHOOK_INBOUND_ALLOW_UNSAFE=true for dev only)");
      res.writeHead(503).end();
      return;
    }
    if (expectedSecret && !verifyBearer(req.headers["authorization"] as string | undefined, expectedSecret)) {
      res.writeHead(401).end();
      return;
    }
    try {
      const buf = await readBody(req);
      const raw = buf.length ? JSON.parse(buf.toString("utf8")) : {};
      const event = normalise(raw);
      if (event) {
        // Deliverability canary: a probe from another of our numbers. Mark it
        // delivered (clears the sender's slow-ban flag) and swallow it — no
        // conversation/message, no bot/autoresponder, no notification.
        if (await handleProbeReceipt(event)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, swallowed: "probe" }));
          return;
        }
        const persisted = await persistEvent({ workspaceId: workspaceId!, instanceId: instanceId! }, event);
        // Enrich the published event with conversationId so the socket fan-out can route per-conversation.
        const enriched =
          event.kind === "message"
            ? { ...event, conversationId: persisted.conversation?.id, messageRowId: persisted.message?.id }
            : event;
        await publishEvent(workspaceId!, { event: enriched, instanceId });
        if (event.kind === "message" && event.direction === "inbound" && persisted.conversation && persisted.message) {
          void emitWebhook(workspaceId!, "message.received", {
            instanceId,
            conversationId: persisted.conversation.id,
            from: event.contactPhone,
            name: persisted.conversation.contactName ?? null,
            type: event.type,
            body: event.body ?? null,
          });
          automate({
            workspaceId: workspaceId!,
            instanceId: instanceId!,
            conversationId: persisted.conversation.id,
            contactPhone: event.contactPhone,
            contactName: persisted.conversation.contactName ?? undefined,
            inboundText: event.body ?? "",
          }).catch((err) => log.error({ err: String(err) }, "automate failed"));
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      log.error({ err: String(err) }, "ingest failed");
      res.writeHead(500).end();
    }
    return;
  }

  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => log.info({ port }, "ingest started"));
