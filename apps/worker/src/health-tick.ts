import { prisma } from "@evo/db";
import { computeHealthScore, utcDateStamp, type RiskLevel } from "@evo/health";
import { emitWebhook } from "@evo/webhooks";
import { collectMetrics } from "./health-metrics.js";

/** Truncate to UTC midnight so @db.Date upserts are stable. */
function utcDate(now: Date): Date {
  return new Date(utcDateStamp(now) + "T00:00:00.000Z");
}

async function priorRiskBefore(instanceId: string, today: Date): Promise<RiskLevel | null> {
  const prev = await prisma.instanceHealthSnapshot.findFirst({
    where: { instanceId, date: { lt: today } },
    orderBy: { date: "desc" },
    select: { risk: true },
  });
  return (prev?.risk as RiskLevel) ?? null;
}


export async function runHealthTick(opts?: { now?: Date }): Promise<{ snapshotted: number }> {
  const now = opts?.now ?? new Date();
  const today = utcDate(now);
  const instances = await prisma.instance.findMany({ select: { id: true, workspaceId: true } });

  let snapshotted = 0;
  for (const inst of instances) {
    const metrics = await collectMetrics(inst.id, inst.workspaceId, now);
    const { score, risk } = computeHealthScore(metrics);

    const existingToday = await prisma.instanceHealthSnapshot.findUnique({
      where: { instanceId_date: { instanceId: inst.id, date: today } },
      select: { risk: true },
    });
    const priorRisk = (existingToday?.risk as RiskLevel) ?? (await priorRiskBefore(inst.id, today));

    await prisma.instanceHealthSnapshot.upsert({
      where: { instanceId_date: { instanceId: inst.id, date: today } },
      create: { workspaceId: inst.workspaceId, instanceId: inst.id, date: today, score, risk, metrics: metrics as any },
      update: { score, risk, metrics: metrics as any },
    });
    snapshotted += 1;

    // Alert only on transition INTO at_risk.
    if (risk === "at_risk" && priorRisk !== "at_risk") {
      await prisma.healthAlert.create({
        data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "went_at_risk", detail: { score } as any },
      });
      await emitWebhook(inst.workspaceId, "health.at_risk", { instanceId: inst.id, score });

      const policy = await prisma.instanceHealthPolicy.findUnique({ where: { instanceId: inst.id } });
      if (policy?.autoProtect) {
        const paused = await prisma.broadcast.updateMany({
          where: { instanceId: inst.id, status: "running" },
          data: { status: "paused" },
        });
        if (paused.count > 0) {
          await prisma.healthAlert.create({
            data: { workspaceId: inst.workspaceId, instanceId: inst.id, kind: "auto_protected", detail: { pausedBroadcasts: paused.count } as any },
          });
          await emitWebhook(inst.workspaceId, "health.auto_protected", { instanceId: inst.id, pausedBroadcasts: paused.count });
        }
      }
    }
  }
  return { snapshotted };
}
