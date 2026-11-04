import { NextResponse } from "next/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { sendViaInstance } from "@/lib/send";
import { AppError } from "@evo/shared";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  try {
    const { workspace } = await requireMember(slug, "Admin");
    const db = tenantClient(workspace.id);

    // Resolve the instance under test by its cuid.
    const instance = await db.instance.findFirst({ where: { id } });
    if (!instance) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    // Find a control: another open instance in the same workspace with a known phone.
    const control = await db.instance.findFirst({
      where: {
        id: { not: id },
        connectionState: "open",
        phoneNumber: { not: null },
      },
    });
    if (!control) {
      return NextResponse.json({ error: "NEEDS_TWO_NUMBERS" }, { status: 400 });
    }

    // Create the probe record.
    const token = `p_${id}_${Date.now()}`;
    await db.deliverabilityProbe.create({
      data: {
        workspaceId: workspace.id,
        instanceId: instance.id,
        controlInstanceId: control.id,
        token,
      },
    });

    // Fire the canary message from the number under test to the control number.
    try {
      await sendViaInstance(
        instance.id,
        {
          type: "text",
          to: control.phoneNumber!,
          text: `wasap-probe:${token}`,
          userId: null,
        },
        { origin: "warmer" },
      );
      return NextResponse.json({ ok: true, controlLabel: control.label });
    } catch (sendErr: unknown) {
      const message = String((sendErr as Error)?.message ?? sendErr);
      return NextResponse.json({ status: "error", message }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof AppError) {
      return NextResponse.json({ error: e.message || e.code }, { status: e.status });
    }
    throw e;
  }
}
