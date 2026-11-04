"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Plan = { id: string; kind: string; name: string; description: string; contactCap: number; instanceCap: number; monthlyMessageCap: number; featureFlags: any };

// Known feature flags rendered as GUI controls (no JSON needed).
const BOOL_FLAGS: { key: string; label: string; help: string }[] = [
  { key: "warmer", label: "Number warmer", help: "AI/template warm-up between numbers" },
  { key: "aiChatbot", label: "AI chatbot", help: "Automated AI replies" },
];
const NUM_FLAGS: { key: string; label: string; help: string }[] = [
  { key: "multiTenantWorkspaceCount", label: "Max workspaces", help: "0 = single workspace" },
  { key: "storageCapMb", label: "Storage cap (MB)", help: "Total media storage. 0 = unlimited" },
];
const KNOWN_KEYS = new Set([...BOOL_FLAGS, ...NUM_FLAGS].map((f) => f.key));

function asObject(v: any): Record<string, any> {
  if (v && typeof v === "object") return v;
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

export default function PlansEditor({ initial }: { initial: Plan[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Plan[]>(() => initial.map((p) => ({ ...p, featureFlags: asObject(p.featureFlags) })));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(plan: Plan) {
    setBusy(true);
    setSaved(null);
    await fetch("/api/admin/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: plan.kind, name: plan.name, description: plan.description,
        contactCap: plan.contactCap, instanceCap: plan.instanceCap, monthlyMessageCap: plan.monthlyMessageCap,
        featureFlags: asObject(plan.featureFlags),
      }),
    });
    setBusy(false);
    setSaved(plan.id);
    router.refresh();
  }

  function patch(id: string, field: keyof Plan, value: any) {
    setItems((arr) => arr.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }
  function patchFlag(id: string, key: string, value: any) {
    setItems((arr) => arr.map((p) => p.id === id ? { ...p, featureFlags: { ...asObject(p.featureFlags), [key]: value } } : p));
  }

  return (
    <div className="space-y-4">
      {items.map((p) => {
        const flags = asObject(p.featureFlags);
        const extraKeys = Object.keys(flags).filter((k) => !KNOWN_KEYS.has(k));
        return (
          <Card key={p.id}>
            <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex gap-2 items-center">
                <span className="text-xs uppercase bg-muted px-2 py-0.5 rounded">{p.kind}</span>
                <input className="border rounded p-1 text-sm" value={p.name} onChange={(e) => patch(p.id, "name", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                {saved === p.id && !busy && <span className="text-xs text-green-700">Saved</span>}
                <Button size="sm" disabled={busy} onClick={() => save(p)}>Save</Button>
              </div>
            </div>

            <textarea className="w-full border rounded p-2 text-xs" rows={2} value={p.description} onChange={(e) => patch(p.id, "description", e.target.value)} />

            <div className="grid grid-cols-3 gap-2 text-xs">
              <label className="space-y-1"><span>Contact cap</span><input type="number" className="w-full border rounded p-1" value={p.contactCap} onChange={(e) => patch(p.id, "contactCap", Number(e.target.value))} /></label>
              <label className="space-y-1"><span>Instance cap (numbers)</span><input type="number" className="w-full border rounded p-1" value={p.instanceCap} onChange={(e) => patch(p.id, "instanceCap", Number(e.target.value))} /></label>
              <label className="space-y-1"><span>Msg / month cap</span><input type="number" className="w-full border rounded p-1" value={p.monthlyMessageCap} onChange={(e) => patch(p.id, "monthlyMessageCap", Number(e.target.value))} /></label>
            </div>

            {/* Feature flags as GUI — no JSON */}
            <div className="border-t pt-3 space-y-2">
              <span className="text-sm font-medium">Features</span>
              <div className="flex flex-wrap gap-4">
                {BOOL_FLAGS.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm" title={f.help}>
                    <input type="checkbox" checked={!!flags[f.key]} onChange={(e) => patchFlag(p.id, f.key, e.target.checked)} />
                    {f.label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {NUM_FLAGS.map((f) => (
                  <label key={f.key} className="space-y-1" title={f.help}>
                    <span>{f.label}</span>
                    <input type="number" min={0} className="w-full border rounded p-1" value={Number(flags[f.key] ?? 0)} onChange={(e) => patchFlag(p.id, f.key, Number(e.target.value) || 0)} />
                  </label>
                ))}
              </div>
              {extraKeys.length > 0 && (
                <p className="text-xs text-muted-foreground">Other flags preserved: {extraKeys.join(", ")}</p>
              )}
            </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
