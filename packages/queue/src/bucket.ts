import { redis } from "./redis";
import type { BucketConfig, BucketTakeResult } from "./types";

const TAKE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local existing = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(existing[1])
local lastTs = tonumber(existing[2])
if tokens == nil then
  tokens = capacity
  lastTs = nowMs
end
local elapsed = math.max(0, nowMs - lastTs) / 1000
local refill = elapsed * refillPerSecond
tokens = math.min(capacity, tokens + refill)
local granted = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
end
redis.call("HMSET", key, "tokens", tokens, "ts", nowMs)
redis.call("PEXPIRE", key, 3600000)
return {granted, tostring(tokens)}
`;

export interface TokenBucket {
  take(opts: { waitMs: number }): Promise<BucketTakeResult>;
}

export function tokenBucket(instanceKey: string, cfg: BucketConfig): TokenBucket {
  const redisKey = `bucket:${instanceKey}`;
  return {
    async take({ waitMs }: { waitMs: number }): Promise<BucketTakeResult> {
      const startedAt = Date.now();
      const deadline = startedAt + waitMs;
      let waitedMs = 0;
      while (true) {
        const result = (await redis().eval(
          TAKE_SCRIPT,
          1,
          redisKey,
          cfg.capacity.toString(),
          cfg.refillPerSecond.toString(),
          Date.now().toString(),
        )) as [number, string];
        const [granted, remainingStr] = result;
        const remaining = Number(remainingStr);
        if (granted === 1) {
          return { granted: true, waitedMs, remaining };
        }
        if (Date.now() >= deadline) {
          return { granted: false, waitedMs, remaining };
        }
        const msUntilNext = Math.max(50, Math.ceil(1000 / cfg.refillPerSecond));
        const sleepFor = Math.min(msUntilNext, Math.max(50, deadline - Date.now()));
        const sleepStart = Date.now();
        await new Promise((r) => setTimeout(r, sleepFor));
        waitedMs += Date.now() - sleepStart;
      }
    },
  };
}
