import { describe, it, expect, vi, beforeEach } from "vitest";

const { countContacts, countInstances, countMessages, mockFindUnique } = vi.hoisted(() => ({
  countContacts: vi.fn(),
  countInstances: vi.fn(),
  countMessages: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock("@evo/db", () => ({
  prisma: {
    workspacePlan: {
      findUnique: mockFindUnique,
    },
    contact: {
      count: countContacts,
    },
    instance: {
      count: countInstances,
    },
    message: {
      count: countMessages,
    },
  },
}));

import { requireUnder, type LimitKind } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue({
    plan: { contactCap: 100, instanceCap: 2, monthlyMessageCap: 1000, featureFlags: {} },
  });
});

describe("requireUnder", () => {
  it("returns { allowed: true } when under cap (contact)", async () => {
    countContacts.mockResolvedValue(50);
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(50);
    expect(result.cap).toBe(100);
  });

  it("returns { allowed: false } when at cap (contact)", async () => {
    countContacts.mockResolvedValue(100);
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(100);
    expect(result.cap).toBe(100);
  });

  it("returns { allowed: true } for instance under cap", async () => {
    countInstances.mockResolvedValue(1);
    const result = await requireUnder("ws-1", "instance");
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(2);
  });

  it("returns { allowed: false } when monthly messages exceeded", async () => {
    countMessages.mockResolvedValue(1000);
    const result = await requireUnder("ws-1", "messageMonthly");
    expect(result.allowed).toBe(false);
    expect(result.cap).toBe(1000);
  });

  it("returns { allowed: true, cap: Infinity } when PLAN_ENFORCE=false", async () => {
    process.env.PLAN_ENFORCE = "false";
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(true);
    expect(result.cap).toBe(Infinity);
    delete process.env.PLAN_ENFORCE;
  });

  it("fails closed when no plan is attached to the workspace", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await requireUnder("ws-1", "contact");
    expect(result.allowed).toBe(false);
    expect(result.cap).toBe(0);
  });
});
