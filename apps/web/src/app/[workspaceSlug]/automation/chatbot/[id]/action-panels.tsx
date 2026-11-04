"use client";
import { useTranslations } from "next-intl";
import type { BotAction, BotActionType } from "@evo/flow-actions";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { MediaPicker } from "@/components/media-picker";

const CONTACT_VARS = [
  { label: "Contact name", value: "contact.name" },
  { label: "Contact phone", value: "contact.phone" },
  { label: "Last message", value: "response" },
];

type Opt = { id: string; name: string };

const ADDABLE: BotActionType[] = [
  "send_text",
  "save_response",
  "forward_message",
  "add_labels",
  "remove_labels",
  "add_to_group",
  "remove_from_group",
  "rest_api",
  "next_action",
];

function emptyAction(type: BotActionType): BotAction {
  switch (type) {
    case "send_text": return { type, text: "", presenceDelaySec: 0, mediaAssetId: null };
    case "save_response": return { type, fieldKey: "" };
    case "forward_message": return { type, mode: "all", numbers: [""] };
    case "add_labels": return { type, labelIds: [] };
    case "remove_labels": return { type, labelIds: [] };
    case "add_to_group": return { type, listIds: [] };
    case "remove_from_group": return { type, listIds: [] };
    case "rest_api": return { type, method: "POST", url: "", headers: {}, bodyTemplate: "" };
    case "next_action": return { type, keyword: "" };
  }
}

export function ActionEditor({
  workspaceSlug,
  actions,
  onChange,
  labels,
  lists,
}: {
  workspaceSlug: string;
  actions: BotAction[];
  onChange: (a: BotAction[]) => void;
  labels: Opt[];
  lists: Opt[];
}) {
  const t = useTranslations();

  const set = (i: number, next: BotAction) =>
    onChange(actions.map((a, idx) => (idx === i ? next : a)));
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const add = (type: BotActionType) => onChange([...actions, emptyAction(type)]);

  return (
    <div className="space-y-3">
      <select
        className="border rounded p-2"
        value=""
        onChange={(e) => e.target.value && add(e.target.value as BotActionType)}
      >
        <option value="">{t("automation.rule.addAction")}…</option>
        {ADDABLE.map((tp) => (
          <option key={tp} value={tp}>
            {tp}
          </option>
        ))}
      </select>

      {actions.map((a, i) => (
        <div key={i} className="border rounded p-3 space-y-2">
          <div className="flex justify-between">
            <strong>{a.type}</strong>
            <button
              type="button"
              className="text-destructive text-sm underline"
              onClick={() => remove(i)}
            >
              {t("automation.rule.removeAction")}
            </button>
          </div>

          {a.type === "send_text" && (
            <>
              <WhatsAppRichEditor
                value={a.text}
                onChange={(v) => set(i, { ...a, text: v })}
                placeholder={t("automation.rule.sendText")}
                variables={CONTACT_VARS}
                minRows={3}
              />
              <label className="block text-sm">
                {t("automation.rule.presenceDelay")}
                <input
                  type="number"
                  className="border rounded p-2 w-32 ml-2"
                  min={0}
                  max={30}
                  value={a.presenceDelaySec}
                  onChange={(e) => set(i, { ...a, presenceDelaySec: Number(e.target.value) })}
                />
              </label>
              <div className="space-y-1">
                <span className="text-sm">{t("automation.rule.mediaFile")}</span>
                <MediaPicker
                  workspaceSlug={workspaceSlug}
                  value={a.mediaAssetId ?? null}
                  onChange={(assetId) => set(i, { ...a, mediaAssetId: assetId })}
                />
              </div>
            </>
          )}

          {a.type === "save_response" && (
            <>
              <input
                className="w-full border rounded p-2"
                placeholder="customField key (e.g. favColour)"
                value={a.fieldKey}
                onChange={(e) => set(i, { ...a, fieldKey: e.target.value })}
              />
              <WhatsAppRichEditor
                value={a.prompt ?? ""}
                onChange={(v) => set(i, { ...a, prompt: v || undefined })}
                placeholder="Prompt message (optional)"
                variables={CONTACT_VARS}
                minRows={3}
              />
            </>
          )}

          {a.type === "forward_message" && (
            <>
              <select
                className="border rounded p-2"
                value={a.mode}
                onChange={(e) =>
                  set(i, { ...a, mode: e.target.value as "all" | "rotator" })
                }
              >
                <option value="all">{t("automation.rule.forwardAll")}</option>
                <option value="rotator">{t("automation.rule.rotator")}</option>
              </select>
              <input
                className="w-full border rounded p-2"
                placeholder="60xxxx,60yyyy"
                value={a.numbers.join(",")}
                onChange={(e) =>
                  set(i, {
                    ...a,
                    numbers: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </>
          )}

          {(a.type === "add_labels" || a.type === "remove_labels") && (
            <select
              multiple
              className="w-full border rounded p-2 h-24"
              value={a.labelIds}
              onChange={(e) =>
                set(i, {
                  ...a,
                  labelIds: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          {(a.type === "add_to_group" || a.type === "remove_from_group") && (
            <select
              multiple
              className="w-full border rounded p-2 h-24"
              value={a.listIds}
              onChange={(e) =>
                set(i, {
                  ...a,
                  listIds: Array.from(e.target.selectedOptions, (o) => o.value),
                })
              }
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          {a.type === "rest_api" && (
            <>
              <div className="flex gap-2">
                <select
                  className="border rounded p-2"
                  value={a.method}
                  onChange={(e) => set(i, { ...a, method: e.target.value as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" })}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  className="border rounded p-2 flex-1"
                  placeholder="https://…"
                  value={a.url}
                  onChange={(e) => set(i, { ...a, url: e.target.value })}
                />
              </div>
              <textarea
                className="w-full border rounded p-2"
                rows={2}
                placeholder='{"from":"{{contact.phone}}"}'
                value={a.bodyTemplate}
                onChange={(e) => set(i, { ...a, bodyTemplate: e.target.value })}
              />
            </>
          )}

          {a.type === "next_action" && (
            <input
              className="w-full border rounded p-2"
              placeholder={t("automation.rule.keywords")}
              value={a.keyword}
              onChange={(e) => set(i, { ...a, keyword: e.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}
