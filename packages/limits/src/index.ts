import { prisma } from "@evo/db";

export type LimitKind = "contact" | "instance" | "messageMonthly";

export interface LimitResult {
  allowed: boolean;
  used: number;
  cap: number;
}

export async function requireUnder(workspaceId: string, kind: LimitKind): Promise<LimitResult> {
  if (process.env.PLAN_ENFORCE === "false") {
    return { allowed: true, used: 0, cap: Infinity };
  }

  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!wp) {
    // Fail closed: a workspace without a plan should not bypass caps.
    // (PLAN_ENFORCE=false short-circuit above keeps dev unrestricted.)
    // eslint-disable-next-line no-console
    console.warn(`workspace ${workspaceId} has no plan; failing closed`);
    return { allowed: false, used: 0, cap: 0 };
  }

  let cap = 0;
  let used = 0;
  if (kind === "contact") {
    cap = wp.plan.contactCap;
    used = await prisma.contact.count({ where: { workspaceId } });
  } else if (kind === "instance") {
    cap = wp.plan.instanceCap;
    used = await prisma.instance.count({ where: { workspaceId } });
  } else if (kind === "messageMonthly") {
    cap = wp.plan.monthlyMessageCap;
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    used = await prisma.message.count({
      where: { workspaceId, sentAt: { gte: start } },
    });
  }

  return { allowed: used < cap, used, cap };
}

export interface StorageResult {
  allowed: boolean;
  usedBytes: number;
  capBytes: number; // Infinity when no cap set
  capMb: number; // 0 = unlimited
}

/**
 * Media storage limit for a workspace, driven by the plan's featureFlags.storageCapMb.
 * A cap of 0 / unset means unlimited. Unlike count caps, this enforces whenever a
 * cap is set (independent of PLAN_ENFORCE) so admins can cap storage per plan even
 * while other caps stay relaxed.
 */
export async function checkStorage(workspaceId: string, addBytes = 0): Promise<StorageResult> {
  const wp = await prisma.workspacePlan.findUnique({ where: { workspaceId }, include: { plan: true } });
  const flags = (wp?.plan.featureFlags ?? {}) as Record<string, unknown>;
  const capMb = Number(flags?.storageCapMb ?? 0);
  const agg = await prisma.mediaAsset.aggregate({ where: { workspaceId }, _sum: { sizeBytes: true } });
  const usedBytes = agg._sum.sizeBytes ?? 0;
  if (!capMb || capMb <= 0) return { allowed: true, usedBytes, capBytes: Infinity, capMb: 0 };
  const capBytes = capMb * 1024 * 1024;
  return { allowed: usedBytes + addBytes <= capBytes, usedBytes, capBytes, capMb };
}

export async function featureEnabled(workspaceId: string, flag: string): Promise<boolean> {
  if (process.env.PLAN_ENFORCE === "false") return true;
  const wp = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
    include: { plan: true },
  });
  if (!wp) return false;
  const flags = wp.plan.featureFlags as Record<string, unknown>;
  return Boolean(flags?.[flag]);
}
