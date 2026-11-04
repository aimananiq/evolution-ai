# Outbound Webhooks — n8n / Zapier / Make / Google Sheets

Evolution Manager delivers **signed, retried HTTP POSTs** to any URL you subscribe under
**Settings → Webhooks**. This is the integration surface for no-code tools.

## Events

| Event | Fires when | Payload `data` |
|---|---|---|
| `message.received` | A customer sends an inbound message | `instanceId, conversationId, from, name, type, body` |
| `message.sent` | An agent sends a reply from the inbox | `instanceId, conversationId, to, textPreview` |
| `message.status` | Evolution reports a delivery/read status | `instanceId, evolutionMessageId, status` |
| `instance.state` | A number connects/disconnects | `instanceId, state` |
| `broadcast.completed` | A broadcast finishes | `broadcastId, name, sent, failed, total` |
| `broadcast.failed` | A finished broadcast had failed targets | `broadcastId, name, sent, failed, total` |
| `health.at_risk` | A number's health score drops to at-risk | `instanceId, score` |
| `health.auto_protected` | Broadcasts auto-paused for an at-risk number | `instanceId, pausedBroadcasts` |
| `health.ramp_cap_reached` | A number hit its daily warm-up cap | `instanceId, cap` |

## Payload envelope

```json
{ "event": "message.received", "at": "2026-07-04T09:00:00.000Z", "data": { "...": "..." } }
```

## Headers

| Header | Value |
|---|---|
| `x-webhook-event` | the event name |
| `x-webhook-id` | unique delivery id |
| `x-webhook-timestamp` | ISO 8601 send time |
| `x-webhook-signature` | `sha256=<hex>` — HMAC-SHA256 of the **raw body** keyed by the subscription secret |

Deliveries retry up to 5 times with exponential backoff. Every attempt is recorded in the
**Recent deliveries** panel.

## Verifying the signature (any language)

```
expected = "sha256=" + hex( HMAC_SHA256(secret, rawRequestBody) )
constant_time_equals(expected, header["x-webhook-signature"])
```

## n8n setup

1. Add a **Webhook** node (HTTP method POST). Copy its Production URL.
2. In Evolution Manager → **Settings → Webhooks**, create a subscription with that URL,
   pick the events you want, and copy the signing secret shown once.
3. (Recommended) Add a **Crypto** node → HMAC, SHA256, secret = your signing secret,
   value = the raw body; then an **IF** node comparing `sha256=<crypto output>` to
   `{{$json.headers["x-webhook-signature"]}}`. Reject on mismatch.
4. Build your flow off `{{$json.body.event}}` and `{{$json.body.data}}`.

**To send messages back** into WhatsApp from n8n, use an **Inbound integration**
(Settings → Integrations → Inbound webhooks): n8n POSTs a JSON payload with the recipient
and text, and the manager sends it through the chosen instance.

Zapier, Make, and Google Sheets (via Apps Script `doPost`) consume the same signed POSTs.
