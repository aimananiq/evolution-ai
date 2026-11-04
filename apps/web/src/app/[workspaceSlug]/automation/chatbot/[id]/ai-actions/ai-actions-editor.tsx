"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";

const CONTACT_VARS = [
  { label: "Contact name", value: "contact.name" },
  { label: "Contact phone", value: "contact.phone" },
  { label: "Last message", value: "response" },
];

type Opt = { id: string; name: string };

type AutoLabelRule = { contains: string; labelId: string; op: "add" | "remove" };
type AutoLabel = { enabled: boolean; rules: AutoLabelRule[] };

type HumanTakeover = {
  enabled: boolean;
  triggerKeywords: string[];
  notifyType: "whatsapp_number" | "whatsapp_group";
  notifyTargets: string[];
  agentMessageTemplate: string;
  disableBotOnTakeover: boolean;
  userMessage: string;
};

type FollowUpStep = { text: string; delaySeconds: number; mediaAssetId: string | null };
type AutoFollowUp = {
  enabled: boolean;
  lastSenderFilter: "chatbot" | "customer";
  conditions: { contactGroupIds: string[]; labelIds: string[] };
  steps: FollowUpStep[];
};

type Initial = {
  autoLabel: AutoLabel;
  humanTakeover: HumanTakeover;
  autoFollowUp: AutoFollowUp;
} | null;

const defaultAutoLabel = (): AutoLabel => ({ enabled: false, rules: [] });
const defaultHumanTakeover = (): HumanTakeover => ({
  enabled: false,
  triggerKeywords: [],
  notifyType: "whatsapp_number",
  notifyTargets: [],
  agentMessageTemplate: "",
  disableBotOnTakeover: true,
  userMessage: "",
});
const defaultAutoFollowUp = (): AutoFollowUp => ({
  enabled: false,
  lastSenderFilter: "customer",
  conditions: { contactGroupIds: [], labelIds: [] },
  steps: [],
});

export default function AiActionsEditor({
  workspaceSlug,
  chatbotId,
  labels,
  initial,
}: {
  workspaceSlug: string;
  chatbotId: string;
  labels: Opt[];
  initial: Initial;
}) {
  const t = useTranslations();

  const [autoLabel, setAutoLabel] = useState<AutoLabel>(
    initial?.autoLabel ?? defaultAutoLabel()
  );
  const [humanTakeover, setHumanTakeover] = useState<HumanTakeover>(
    initial?.humanTakeover ?? defaultHumanTakeover()
  );
  const [keywordsRaw, setKeywordsRaw] = useState(
    initial?.humanTakeover?.triggerKeywords?.join(", ") ?? ""
  );
  const [targetsRaw, setTargetsRaw] = useState(
    initial?.humanTakeover?.notifyTargets?.join(", ") ?? ""
  );
  const [autoFollowUp, setAutoFollowUp] = useState<AutoFollowUp>(
    initial?.autoFollowUp ?? defaultAutoFollowUp()
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addRule() {
    setAutoLabel((prev) => ({
      ...prev,
      rules: [...prev.rules, { contains: "", labelId: labels[0]?.id ?? "", op: "add" }],
    }));
  }

  function updateRule(i: number, patch: Partial<AutoLabelRule>) {
    setAutoLabel((prev) => ({
      ...prev,
      rules: prev.rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  }

  function removeRule(i: number) {
    setAutoLabel((prev) => ({ ...prev, rules: prev.rules.filter((_, idx) => idx !== i) }));
  }

  function addStep() {
    setAutoFollowUp((prev) => ({
      ...prev,
      steps: [...prev.steps, { text: "", delaySeconds: 3600, mediaAssetId: null }],
    }));
  }

  function updateStep(i: number, patch: Partial<FollowUpStep>) {
    setAutoFollowUp((prev) => ({
      ...prev,
      steps: prev.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }

  function removeStep(i: number) {
    setAutoFollowUp((prev) => ({ ...prev, steps: prev.steps.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      autoLabel,
      humanTakeover: {
        ...humanTakeover,
        triggerKeywords: keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean),
        notifyTargets: targetsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      },
      autoFollowUp,
    };
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/ai-actions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Failed to save");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Auto Label */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("aiActions.autoLabel")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoLabel.enabled}
            onChange={(e) => setAutoLabel((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {t("aiActions.enabled")}
        </label>
        {autoLabel.rules.map((rule, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-end border-t pt-2">
            <label className="block text-xs flex-1 min-w-[140px]">
              {t("aiActions.containsText")}
              <input
                className="w-full border rounded p-1 mt-0.5 text-sm"
                value={rule.contains}
                onChange={(e) => updateRule(i, { contains: e.target.value })}
                maxLength={200}
              />
            </label>
            <label className="block text-xs flex-1 min-w-[120px]">
              {t("aiActions.labelToApply")}
              <select
                className="w-full border rounded p-1 mt-0.5 text-sm"
                value={rule.labelId}
                onChange={(e) => updateRule(i, { labelId: e.target.value })}
              >
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              {t("aiActions.operation")}
              <select
                className="border rounded p-1 mt-0.5 text-sm"
                value={rule.op}
                onChange={(e) => updateRule(i, { op: e.target.value as "add" | "remove" })}
              >
                <option value="add">Add</option>
                <option value="remove">Remove</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => removeRule(i)}
              className="text-destructive text-xs underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addRule} className="text-sm text-foreground underline">
          + {t("aiActions.addRule")}
        </button>
      </section>

      {/* Human Takeover */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("aiActions.humanTakeover")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={humanTakeover.enabled}
            onChange={(e) => setHumanTakeover((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {t("aiActions.enabled")}
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.triggerKeywords")}</span>
          <input
            className="w-full border rounded p-2 mt-1 text-sm"
            value={keywordsRaw}
            onChange={(e) => setKeywordsRaw(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.notifyType")}</span>
          <select
            className="w-full border rounded p-2 mt-1 text-sm"
            value={humanTakeover.notifyType}
            onChange={(e) => setHumanTakeover((prev) => ({ ...prev, notifyType: e.target.value as "whatsapp_number" | "whatsapp_group" }))}
          >
            <option value="whatsapp_number">WhatsApp number</option>
            <option value="whatsapp_group">WhatsApp group</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.notifyTargets")}</span>
          <input
            className="w-full border rounded p-2 mt-1 text-sm"
            value={targetsRaw}
            onChange={(e) => setTargetsRaw(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.agentMessage")}</span>
          <WhatsAppRichEditor
            value={humanTakeover.agentMessageTemplate}
            onChange={(v) => setHumanTakeover((prev) => ({ ...prev, agentMessageTemplate: v }))}
            variables={[{ label: "User phone", value: "user_phone" }]}
            minRows={3}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={humanTakeover.disableBotOnTakeover}
            onChange={(e) => setHumanTakeover((prev) => ({ ...prev, disableBotOnTakeover: e.target.checked }))}
          />
          {t("aiActions.disableBot")}
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.userMessage")}</span>
          <WhatsAppRichEditor
            value={humanTakeover.userMessage}
            onChange={(v) => setHumanTakeover((prev) => ({ ...prev, userMessage: v }))}
            minRows={3}
          />
        </label>
      </section>

      {/* Auto Follow-Up */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("aiActions.autoFollowUp")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoFollowUp.enabled}
            onChange={(e) => setAutoFollowUp((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {t("aiActions.enabled")}
        </label>
        <label className="block">
          <span className="text-sm">{t("aiActions.lastSender")}</span>
          <select
            className="w-full border rounded p-2 mt-1 text-sm"
            value={autoFollowUp.lastSenderFilter}
            onChange={(e) => setAutoFollowUp((prev) => ({ ...prev, lastSenderFilter: e.target.value as "chatbot" | "customer" }))}
          >
            <option value="chatbot">Chatbot (after bot replied)</option>
            <option value="customer">Customer (no reply from customer)</option>
          </select>
        </label>

        {autoFollowUp.steps.map((step, i) => (
          <div key={i} className="border-t pt-2 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-foreground">Step {i + 1}</span>
              <button type="button" onClick={() => removeStep(i)} className="text-destructive text-xs underline">Remove</button>
            </div>
            <label className="block text-xs">
              {t("aiActions.followUpText")}
              <WhatsAppRichEditor
                value={step.text}
                onChange={(v) => updateStep(i, { text: v })}
                variables={CONTACT_VARS}
                minRows={3}
              />
            </label>
            <label className="block text-xs">
              {t("aiActions.delaySeconds")}
              <input
                type="number"
                className="w-full border rounded p-1 mt-0.5 text-sm"
                value={step.delaySeconds}
                min={0}
                onChange={(e) => updateStep(i, { delaySeconds: parseInt(e.target.value, 10) || 0 })}
              />
            </label>
            {/* Media: real MediaPicker is available but lives inside a repeatable array —
                using a disabled placeholder to avoid complexity per plan's fallback guidance */}
            <p className="text-xs text-muted-foreground italic">
              Attach media (MediaPicker) — currently disabled in follow-up steps.
            </p>
          </div>
        ))}

        <button type="button" onClick={addStep} className="text-sm text-foreground underline">
          + {t("aiActions.addStep")}
        </button>
      </section>

      {/* Save */}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {saved && <p className="text-green-600 text-sm">Saved.</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm disabled:opacity-50"
      >
        {t("aiActions.save")}
      </button>
    </div>
  );
}
