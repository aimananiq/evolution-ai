import http from "node:http";
import pino from "pino";
import { Queue, Worker } from "bullmq";
import { redis } from "@evo/queue";
import { runScheduler } from "./broadcast-scheduler.js";
import { broadcastSendProcessor } from "./broadcast-send.js";
import { runDripTick } from "./drip-tick.js";
import { runFollowUpTick } from "./follow-up-tick.js";
import { runWarmerTick } from "./warmer-tick.js";
import { runInstanceStateTick } from "./instance-state-tick.js";
import { warmerSendProcessor } from "./warmer-send.js";
import { inboundSendProcessor } from "./inbound-send.js";
import { runHealthTick } from "./health-tick.js";
import { runCanaryTick } from "./canary-tick.js";
import {
  WEBHOOK_FANOUT_QUEUE,
  WEBHOOK_DELIVER_QUEUE,
  runWebhookFanout,
  deliverWebhook,
} from "@evo/webhooks";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(1));
const connection = redis() as any;

const HEARTBEAT_QUEUE = "instance-state-tick";
const BROADCAST_TICK_QUEUE = "broadcast-tick";
const BROADCAST_SEND_QUEUE = "broadcast-send";

const heartbeatQueue = new Queue(HEARTBEAT_QUEUE, { connection });
const broadcastTickQueue = new Queue(BROADCAST_TICK_QUEUE, { connection });
const broadcastSendQueue = new Queue(BROADCAST_SEND_QUEUE, { connection });

await heartbeatQueue.add("tick", {}, { repeat: { every: 60000 }, jobId: "instance-state-tick:repeat" });
await broadcastTickQueue.add("tick", {}, { repeat: { every: 30000 }, jobId: "broadcast-tick:repeat" });

new Worker(HEARTBEAT_QUEUE, async () => {
  const { checked, changed } = await runInstanceStateTick();
  if (changed > 0) log.info({ checked, changed }, "instance-state reconciled");
}, { connection });

new Worker(BROADCAST_TICK_QUEUE, async () => {
  const { enqueued } = await runScheduler(broadcastSendQueue);
  if (enqueued > 0) log.info({ enqueued }, "broadcast scheduler enqueued");
}, { connection });

new Worker(BROADCAST_SEND_QUEUE, broadcastSendProcessor as any, { connection, concurrency: 4 });

const DRIP_TICK_QUEUE = "drip-tick";
const dripTickQueue = new Queue(DRIP_TICK_QUEUE, { connection });
await dripTickQueue.add("tick", {}, { repeat: { every: 60000 }, jobId: "drip-tick:repeat" });
new Worker(DRIP_TICK_QUEUE, async () => {
  const { advanced } = await runDripTick();
  if (advanced > 0) log.info({ advanced }, "drip tick advanced");
}, { connection });

const FOLLOWUP_TICK_QUEUE = "follow-up-tick";
const followUpTickQueue = new Queue(FOLLOWUP_TICK_QUEUE, { connection });
await followUpTickQueue.add("tick", {}, { repeat: { every: 60000 }, jobId: "follow-up-tick:repeat" });
new Worker(FOLLOWUP_TICK_QUEUE, async () => {
  const { sent } = await runFollowUpTick();
  if (sent > 0) log.info({ sent }, "follow-up tick sent");
}, { connection });

const WARMER_TICK_QUEUE = "warmer-tick";
const WARMER_SEND_QUEUE = "warmer-send";
const warmerTickQueue = new Queue(WARMER_TICK_QUEUE, { connection });
const warmerSendQueue = new Queue(WARMER_SEND_QUEUE, { connection });

await warmerTickQueue.add("tick", {}, { repeat: { every: 30000 }, jobId: "warmer-tick:repeat" });

new Worker(WARMER_TICK_QUEUE, async () => {
  const { enqueued } = await runWarmerTick(warmerSendQueue);
  if (enqueued > 0) log.info({ enqueued }, "warmer tick enqueued");
}, { connection });

new Worker(WARMER_SEND_QUEUE, warmerSendProcessor as any, { connection, concurrency: 2 });

const INBOUND_SEND_QUEUE = "inbound-send";
new Worker(INBOUND_SEND_QUEUE, inboundSendProcessor as any, { connection, concurrency: 4 });

const HEALTH_TICK_QUEUE = "health-tick";
const healthTickQueue = new Queue(HEALTH_TICK_QUEUE, { connection });
await healthTickQueue.add("tick", {}, { repeat: { every: 900000 }, jobId: "health-tick:repeat" });
new Worker(HEALTH_TICK_QUEUE, async () => {
  const { snapshotted } = await runHealthTick();
  if (snapshotted > 0) log.info({ snapshotted }, "health tick");
}, { connection });

const CANARY_TICK_QUEUE = "canary-tick";
const canaryTickQueue = new Queue(CANARY_TICK_QUEUE, { connection });
await canaryTickQueue.add("tick", {}, { repeat: { every: 300000 }, jobId: "canary-tick:repeat" });
new Worker(CANARY_TICK_QUEUE, async () => {
  const { probed } = await runCanaryTick();
  if (probed > 0) log.info({ probed }, "canary tick");
}, { connection });

new Worker(WEBHOOK_FANOUT_QUEUE, async (job) => {
  const { enqueued } = await runWebhookFanout(job as any);
  if (enqueued > 0) log.info({ enqueued }, "webhook fanout");
}, { connection, concurrency: 8 });

new Worker(WEBHOOK_DELIVER_QUEUE, deliverWebhook as any, { connection, concurrency: 8 });

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404).end();
});

const port = Number(process.env.PORT ?? 4100);
server.listen(port, () => log.info({ port }, "worker started"));
