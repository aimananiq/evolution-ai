import { describe, it, expect } from "vitest";
import { actionsSchema, parseActions } from "./types";

describe("actionsSchema", () => {
  it("accepts a valid mixed chain and applies defaults", () => {
    const parsed = actionsSchema.parse([
      { type: "send_text", text: "Hi {{contact.name}}" },
      { type: "add_labels", labelIds: ["lbl_1"] },
      { type: "rest_api", url: "https://example.com/hook" },
    ]);
    expect(parsed[0]).toMatchObject({ type: "send_text", presenceDelaySec: 0, mediaAssetId: null });
    expect(parsed[2]).toMatchObject({ type: "rest_api", method: "POST", headers: {} });
  });

  it("rejects an unknown action type", () => {
    expect(() => actionsSchema.parse([{ type: "explode" }])).toThrow();
  });

  it("rejects send_text with empty text", () => {
    expect(() => actionsSchema.parse([{ type: "send_text", text: "" }])).toThrow();
  });

  it("parseActions(null) returns []", () => {
    expect(parseActions(null)).toEqual([]);
  });
});
