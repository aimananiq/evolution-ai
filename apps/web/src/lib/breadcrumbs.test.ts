import { describe, it, expect } from "vitest";
import { buildCrumbs } from "./breadcrumbs";

describe("buildCrumbs", () => {
  it("returns no crumbs on top-level pages", () => {
    expect(buildCrumbs("/acme/dashboard")).toEqual([{ label: "Dashboard", href: null }]);
    expect(buildCrumbs("/acme")).toEqual([]);
  });

  it("builds a linked trail for nested pages, folding id segments", () => {
    expect(buildCrumbs("/acme/instances/cmr6bpvjj00099k7sjwruqviu/pair")).toEqual([
      { label: "Instances", href: "/acme/instances" },
      { label: "Pair", href: null },
    ]);
  });

  it("humanizes kebab-case segments", () => {
    expect(buildCrumbs("/acme/instances/cmr6bpvjj00099k7sjwruqviu/test-send")).toEqual([
      { label: "Instances", href: "/acme/instances" },
      { label: "Test send", href: null },
    ]);
  });

  it("handles deep settings paths (settings crumb targets its members page)", () => {
    expect(buildCrumbs("/acme/settings/webhooks")).toEqual([
      { label: "Settings", href: "/acme/settings/members" },
      { label: "Webhooks", href: null },
    ]);
  });

  it("does not treat short words as ids", () => {
    expect(buildCrumbs("/acme/automation/chatbot")).toEqual([
      { label: "Automation", href: "/acme/automation" },
      { label: "Chatbot", href: null },
    ]);
  });
});
