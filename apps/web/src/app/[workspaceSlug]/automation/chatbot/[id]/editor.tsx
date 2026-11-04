"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BotAction } from "@evo/flow-actions";
import RuleEditor from "./rule-editor";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";

const CONTACT_VARS = [
  { label: "Contact name", value: "contact.name" },
  { label: "Contact phone", value: "contact.phone" },
  { label: "Last message", value: "response" },
];

type Opt = { id: string; name: string };

type Trigger = {
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

type Initial = {
  id: string;
  enabled: boolean;
  welcomeMessage: string | null;
  fallbackProvider: "none" | "claude" | "openai";
  fallbackModel: string | null;
  systemPrompt: string | null;
  topicId: string | null;
  triggers: Trigger[];
};

export default function Editor({
  workspaceSlug,
  instanceId,
  initial,
  labels,
  lists,
}: {
  workspaceSlug: string;
  instanceId: string;
  initial: Initial | null;
  labels: Opt[];
  lists: Opt[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [welcome, setWelcome] = useState(initial?.welcomeMessage ?? "");
  const [provider, setProvider] = useState<"none" | "claude" | "openai">(
    initial?.fallbackProvider ?? "none"
  );
  // Blank = use the workspace's default model (set in Settings → Integrations → AI).
  // Only fill this to force a specific model that matches the workspace provider.
  const [model, setModel] = useState(initial?.fallbackModel ?? "");
  const [prompt, setPrompt] = useState(
    initial?.systemPrompt ?? "You are a friendly customer service agent."
  );
  const [chatbotId, setChatbotId] = useState<string | null>(initial?.id ?? null);
  const [topicId, setTopicId] = useState<string>(initial?.topicId ?? "");
  const [topics, setTopics] = useState<Opt[]>([]);
  const [triggers] = useState<Trigger[]>(initial?.triggers ?? []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/topics`);
      if (!res.ok) return;
      const { topics } = await res.json();
      if (!cancelled) setTopics((topics ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  async function saveChatbot() {
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId,
        enabled,
        welcomeMessage: welcome || null,
        fallbackProvider: provider,
        fallbackModel: provider === "none" ? null : model,
        systemPrompt: provider === "none" ? null : prompt,
      }),
    });
    if (res.ok) {
      const { chatbot } = await res.json();
      setChatbotId(chatbot.id);
      // topicId lives on the PUT /chatbots/{id} route, not the upsert POST.
      await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbot.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId: topicId || null }),
      });
      setBusy(false);
      router.refresh();
    } else {
      setBusy(false);
    }
  }

  async function removeTrigger(id: string | undefined) {
    if (!id || !chatbotId) return;
    const res = await fetch(`/api/workspaces/${workspaceSlug}/chatbots/${chatbotId}/triggers/${id}`, {
      method: "DELETE",
    });
    if (res.ok) router.refresh();
    else alert("Failed to delete rule.");
  }

  return (
    <div className="space-y-6">
      {/* Chatbot settings */}
      <section className="border rounded p-4 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("automation.chatbot.enabled")}
        </label>
        <label className="block">
          <span className="text-sm">{t("automation.chatbot.welcomeMessage")}</span>
          <WhatsAppRichEditor
            value={welcome}
            onChange={(v) => setWelcome(v)}
            variables={CONTACT_VARS}
            minRows={3}
          />
        </label>
        <label className="block">
          <span className="text-sm">Topic</span>
          <select
            className="w-full border rounded p-2 mt-1"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
          >
            <option value="">None (use system prompt below)</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {topicId && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Persona, guardrails, and knowledge come from the Topic — edit it under Automation → Chatbot Topics.
            </span>
          )}
        </label>
        <label className="block">
          <span className="text-sm">AI fallback</span>
          <select
            className="w-full border rounded p-2 mt-1"
            value={provider === "none" ? "none" : "on"}
            onChange={(e) => setProvider(e.target.value === "none" ? "none" : "claude")}
          >
            <option value="none">Off — keyword rules only</option>
            <option value="on">On — answer with AI when no rule matches</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Uses this workspace&apos;s AI provider (set it in{" "}
            <Link href={`/${workspaceSlug}/settings/integrations/ai`} className="underline">Settings → Integrations → AI</Link>
            {" "}— Gemini, Ollama, Grok, Claude…), grounded in your Knowledge base.
          </span>
        </label>
        {provider !== "none" && !topicId && (
          <>
            <label className="block">
              <span className="text-sm">Model override (optional)</span>
              <input
                className="w-full border rounded p-2 mt-1"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                maxLength={80}
                placeholder="leave blank to use the workspace default model"
              />
            </label>
            <label className="block">
              <span className="text-sm">{t("automation.chatbot.systemPrompt")}</span>
              <textarea
                className="w-full border rounded p-2 mt-1"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={4000}
              />
            </label>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={saveChatbot}
          className="bg-primary text-primary-foreground rounded p-2 px-4"
        >
          {t("automation.chatbot.save")}
        </button>
      </section>

      {/* Existing keyword rules */}
      {chatbotId && triggers.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-semibold">{t("automation.chatbot.addTrigger")}</h2>
          {triggers.map((tr) => (
            <div key={tr.id} className="border rounded p-4 space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm text-foreground">
                  {tr.name ?? tr.keyword} ({tr.matchType})
                </span>
                <button
                  type="button"
                  onClick={() => removeTrigger(tr.id)}
                  className="text-destructive text-sm underline"
                >
                  {t("common.delete")}
                </button>
              </div>
              <RuleEditor
                workspaceSlug={workspaceSlug}
                chatbotId={chatbotId}
                labels={labels}
                lists={lists}
                initial={tr}
              />
            </div>
          ))}
        </section>
      )}

      {/* Add new rule */}
      {chatbotId && (
        <section className="border rounded p-4 space-y-4">
          <h2 className="font-semibold">{t("automation.chatbot.addTrigger")} (new)</h2>
          <RuleEditor
            workspaceSlug={workspaceSlug}
            chatbotId={chatbotId}
            labels={labels}
            lists={lists}
            initial={null}
          />
        </section>
      )}

      {!chatbotId && (
        <p className="text-sm text-muted-foreground">
          Save the chatbot settings above first to start adding keyword rules.
        </p>
      )}
    </div>
  );
}
