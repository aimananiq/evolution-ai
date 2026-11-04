"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type PlanOpt = { kind: string; name: string };

export default function WorkspaceActions({
  workspaceId, name, currentPlanKind, plans,
}: { workspaceId: string; name: string; currentPlanKind: string | null; plans: PlanOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changePlan(kind: string) {
    if (!kind) return;
    setBusy(true);
    await fetch(`/api/admin/workspaces/${workspaceId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ planKind: kind }),
    });
    setBusy(false);
    router.refresh();
  }
  async function del() {
    if (!confirm(`Delete workspace "${name}" and ALL its data (numbers, contacts, warmers)? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/workspaces/${workspaceId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Delete failed.");
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <select value={currentPlanKind ?? ""} disabled={busy} onChange={(e) => changePlan(e.target.value)} className="border rounded p-1 text-xs">
        {!currentPlanKind && <option value="">— no plan —</option>}
        {plans.map((p) => <option key={p.kind} value={p.kind}>{p.name}</option>)}
      </select>
      <Button variant="ghost" size="sm" onClick={del} disabled={busy} className="text-destructive hover:text-destructive">Delete</Button>
    </div>
  );
}
