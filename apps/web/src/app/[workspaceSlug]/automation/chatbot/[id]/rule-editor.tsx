"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BotAction } from "@evo/flow-actions";
import { ActionEditor } from "./action-panels";
import { MediaPicker } from "@/components/media-picker";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";

const CONTACT_VARS = [
  { label: "Contact name", value: "contact.name" },
  { label: "Contact phone", value: "contact.phone" },
  { label: "Last message", value: "response" },
];

type Opt = { id: string; name: string };

type RuleInitial = {
  id?: string;
  keyword: string;
  matchType: "exact" | "contains" | "startsWith";
  response: string;
  name: string | null;
  description: string | null;
  sendTo: "all" | "individual" | "group";
  isDefaultReply: boolean;
  presenceDelaySec: number;
  mediaAssetId: string | null;
  actions: BotAction[];
};

export default function RuleEditor({
  workspaceSlug,
  chatbotId,
  labels,
  lists,
  initial,
}: {
  workspaceSlug: string;
  chatbotId: string;
  labels: Opt[];
  lists: Opt[];
  initial: RuleInitial | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [r, setR] = useState<RuleInitial>(
    initial ?? {
      keyword: "",
      matchType: "contains",
      response: "",
      name: null,
      description: null,
      sendTo: "all",
      isDefaultReply: false,
      presenceDelaySec: 0,
      mediaAssetId: null,
      actions: [],
    }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    const url = r.id
      ? `/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers/${r.id}`
      : `/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers`;
    const res = await fetch(url, {
      method: r.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    setBusy(false);
    if (res.ok) {
      setError(null);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "VALIDATION"
          ? "Please fill in all action fields (text, keywords, URLs, and select at least one label/group where required)."
          : (body.error ?? "Save failed.")
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Chatbot | General */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.general")}</h2>
        <label className="block text-sm">
          {t("automation.rule.name")}
          <input
            className="w-full border rounded p-2 mt-1"
            placeholder={t("automation.rule.name")}
            value={r.name ?? ""}
            onChange={(e) => setR({ ...r, name: e.target.value || null })}
            maxLength={120}
          />
        </label>
        <label className="block text-sm">
          {t("automation.rule.description")}
          <textarea
            className="w-full border rounded p-2 mt-1"
            rows={2}
            placeholder={t("automation.rule.description")}
            value={r.description ?? ""}
            onChange={(e) => setR({ ...r, description: e.target.value || null })}
            maxLength={2000}
          />
        </label>
        <label className="block text-sm">
          {t("automation.rule.sendTo")}
          <select
            className="border rounded p-2 mt-1 w-full"
            value={r.sendTo}
            onChange={(e) => setR({ ...r, sendTo: e.target.value as RuleInitial["sendTo"] })}
          >
            <option value="all">{t("automation.rule.sendToAll")}</option>
            <option value="individual">{t("automation.rule.sendToIndividual")}</option>
            <option value="group">{t("automation.rule.sendToGroup")}</option>
          </select>
        </label>
      </section>

      {/* Chatbot | Trigger */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.trigger")}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={r.isDefaultReply}
            onChange={(e) => setR({ ...r, isDefaultReply: e.target.checked })}
          />
          {t("automation.rule.useAsDefault")}
        </label>
        <label className="block text-sm">
          {t("automation.rule.type")}
          <select
            className="border rounded p-2 mt-1 w-full"
            value={r.matchType}
            onChange={(e) => setR({ ...r, matchType: e.target.value as RuleInitial["matchType"] })}
          >
            <option value="contains">{t("automation.rule.typeContains")}</option>
            <option value="exact">{t("automation.rule.typeExact")}</option>
            <option value="startsWith">{t("automation.chatbot.matchStartsWith")}</option>
          </select>
        </label>
        <label className="block text-sm">
          {t("automation.rule.keywords")}
          <input
            className="w-full border rounded p-2 mt-1"
            placeholder={t("automation.rule.keywords")}
            value={r.keyword}
            onChange={(e) => setR({ ...r, keyword: e.target.value })}
            maxLength={80}
          />
        </label>
      </section>

      {/* Chatbot | Content */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.content")}</h2>
        <label className="block text-sm">
          {t("automation.rule.presenceDelay")}
          <input
            type="number"
            className="border rounded p-2 w-40 mt-1 block"
            min={0}
            max={30}
            value={r.presenceDelaySec}
            onChange={(e) => setR({ ...r, presenceDelaySec: Number(e.target.value) })}
          />
        </label>
        {/* Plan 7: MediaPicker wired in (Plan 7 is available) */}
        <div className="space-y-1">
          <span className="text-sm block">{t("automation.rule.mediaFile")}</span>
          <MediaPicker
            workspaceSlug={workspaceSlug}
            value={r.mediaAssetId}
            onChange={(assetId) => setR({ ...r, mediaAssetId: assetId })}
            label={t("automation.rule.mediaFile")}
          />
        </div>
        <label className="block text-sm">
          {t("automation.rule.sendText")}
          <WhatsAppRichEditor
            value={r.response}
            onChange={(v) => setR({ ...r, response: v })}
            placeholder={t("automation.rule.sendText")}
            variables={CONTACT_VARS}
            minRows={3}
          />
        </label>
      </section>

      {/* Chatbot | Advanced */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{t("automation.rule.advanced")}</h2>
        <ActionEditor
          workspaceSlug={workspaceSlug}
          actions={r.actions}
          onChange={(actions) => setR({ ...r, actions })}
          labels={labels}
          lists={lists}
        />
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        disabled={busy || !r.keyword || !r.response}
        onClick={save}
        className="bg-primary text-primary-foreground rounded p-2 px-4 disabled:opacity-50"
      >
        {t("automation.rule.saveRule")}
      </button>
    </div>
  );
}
