import { prisma } from "@evo/db";

export interface AuditInput {
  workspaceId: string;
  userId: string | null;
  action: string;
  target: string;
  diff?: unknown;
  instanceId?: string;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        target: input.target,
        diff: (input.diff ?? undefined) as any,
        instanceId: input.instanceId,
      },
    });
  } catch (err) {
    // Audit failure must never break the caller. Log and swallow.
    // eslint-disable-next-line no-console
    console.error("audit.write failed", err);
  }
}
