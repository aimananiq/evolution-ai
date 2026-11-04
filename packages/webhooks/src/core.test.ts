import { describe, it, expect } from "vitest";
import { matchingSubs, buildDelivery, deliveryHeaders } from "./core";
import { hmacSha256Hex } from "@evo/crypto";

describe("matchingSubs", () => {
  const subs = [
    { id: "a", events: ["message.received", "instance.state"], enabled: true },
    { id: "b", events: ["message.received"], enabled: false },
    { id: "c", events: "not-an-array", enabled: true },
    { id: "d", events: ["broadcast.completed"], enabled: true },
  ];
  it("returns enabled subs whose event list includes the event", () => {
    expect(matchingSubs(subs, "message.received").map((s) => s.id)).toEqual(["a"]);
    expect(matchingSubs(subs, "broadcast.completed").map((s) => s.id)).toEqual(["d"]);
  });
  it("returns none when nothing matches", () => {
    expect(matchingSubs(subs, "health.at_risk")).toHaveLength(0);
  });
});

describe("buildDelivery", () => {
  it("wraps event/at/data and serializes the body", () => {
    const { envelope, body } = buildDelivery("message.received", { from: "601", text: "hi" }, "2026-07-04T00:00:00.000Z");
    expect(envelope).toEqual({ event: "message.received", at: "2026-07-04T00:00:00.000Z", data: { from: "601", text: "hi" } });
    expect(JSON.parse(body)).toEqual(envelope);
  });
});

describe("deliveryHeaders", () => {
  it("signs the body with HMAC-SHA256 and sets the metadata headers", () => {
    const body = '{"event":"x"}';
    const h = deliveryHeaders(body, "secret", "x", "del_1", "2026-07-04T00:00:00.000Z");
    expect(h["x-webhook-event"]).toBe("x");
    expect(h["x-webhook-id"]).toBe("del_1");
    expect(h["x-webhook-signature"]).toBe(`sha256=${hmacSha256Hex(body, "secret")}`);
  });
});
