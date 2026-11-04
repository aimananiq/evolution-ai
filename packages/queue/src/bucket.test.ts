import { describe, it, expect, beforeEach } from "vitest";
import { redis } from "./redis";
import { tokenBucket } from "./bucket";

const TEST_KEY = "test-instance-" + Date.now();

beforeEach(async () => {
  await redis().del(`bucket:${TEST_KEY}`);
});

describe("tokenBucket", () => {
  it("grants a token when bucket is full", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 5, refillPerSecond: 1 });
    const result = await bucket.take({ waitMs: 0 });
    expect(result.granted).toBe(true);
    expect(result.waitedMs).toBe(0);
    expect(result.remaining).toBe(4);
  });

  it("rejects when waitMs is 0 and bucket is empty", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 1, refillPerSecond: 0.1 });
    const first = await bucket.take({ waitMs: 0 });
    expect(first.granted).toBe(true);
    const second = await bucket.take({ waitMs: 0 });
    expect(second.granted).toBe(false);
  });

  it("waits and grants once refill arrives", async () => {
    const bucket = tokenBucket(TEST_KEY, { capacity: 1, refillPerSecond: 5 });
    await bucket.take({ waitMs: 0 });  // drain
    const start = Date.now();
    const result = await bucket.take({ waitMs: 2000 });
    const elapsed = Date.now() - start;
    expect(result.granted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  }, 5000);

  it("separates buckets by key", async () => {
    const a = tokenBucket(TEST_KEY + "-A", { capacity: 1, refillPerSecond: 0.1 });
    const b = tokenBucket(TEST_KEY + "-B", { capacity: 1, refillPerSecond: 0.1 });
    expect((await a.take({ waitMs: 0 })).granted).toBe(true);
    expect((await b.take({ waitMs: 0 })).granted).toBe(true);
    expect((await a.take({ waitMs: 0 })).granted).toBe(false);
  });
});
