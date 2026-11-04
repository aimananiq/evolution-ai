"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Step = { templateId: string; delayMs: number };

export default function Wizard({ workspaceSlug, instances, templates }: {
  workspaceSlug: string;
  instances: { id: string; label: string }[];
  templates: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [steps, setSteps] = useState<Step[]>([{ templateId: templates[0]?.id ?? "", delayMs: 0 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStep() {
    setSteps((s) => [...s, { templateId: templates[0]?.id ?? "", delayMs: 86400000 }]);
  }

  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((s) => s.map((st, idx) => idx === i ? { ...st, ...patch } : st));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/drip-campaigns`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, instanceId, steps }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      return;
    }
    const { campaign } = await res.json();
    router.push(`/${workspaceSlug}/automation/drip/${campaign.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className="w-full border rounded p-2" placeholder={t("automation.drip.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <label className="block">
        <span className="text-sm">{t("automation.drip.instance")}</span>
        <select className="w-full border rounded p-2 mt-1" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Steps</h3>
        {steps.map((st, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-6">
              <span className="text-xs">{t("automation.drip.template")}</span>
              <select className="w-full border rounded p-2" value={st.templateId} onChange={(e) => updateStep(i, { templateId: e.target.value })} required>
                {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
            </div>
            <div className="col-span-4">
              <span className="text-xs">{t("automation.drip.delay")}</span>
              <input type="number" className="w-full border rounded p-2" value={st.delayMs} onChange={(e) => updateStep(i, { delayMs: Number(e.target.value) })} min={0} />
            </div>
            <button type="button" onClick={() => removeStep(i)} disabled={steps.length === 1} className="col-span-2 text-destructive text-sm underline disabled:opacity-50">×</button>
          </div>
        ))}
        <button type="button" onClick={addStep} className="text-sm underline">{t("automation.drip.addStep")}</button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <button disabled={busy} className="bg-primary text-primary-foreground rounded p-2 px-4">{t("automation.drip.create")}</button>
    </form>
  );
}
