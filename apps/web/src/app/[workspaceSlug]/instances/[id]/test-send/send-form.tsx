"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { WhatsAppRichEditor } from "@/components/wa-rich-editor";
import { Button } from "@/components/ui/button";

export default function SendForm({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const t = useTranslations();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}/send-test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, text }),
    });
    setBusy(false);
    if (res.ok) {
      setFeedback(t("instances.sentOk"));
      setText("");
      return;
    }
    if (res.status === 429) {
      setFeedback(t("instances.throttled"));
      return;
    }
    setFeedback(t("instances.sentFailed"));
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-sm">{t("instances.to")}</span>
        <input
          className="w-full border rounded p-2 mt-1"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="60123456789"
          required
          minLength={8}
        />
      </label>
      <label className="block">
        <span className="text-sm">{t("instances.text")}</span>
        <WhatsAppRichEditor
          value={text}
          onChange={(v) => setText(v)}
          ariaLabel={t("instances.text")}
          minRows={4}
        />
      </label>
      {feedback && <p className="text-sm">{feedback}</p>}
      <Button type="submit" disabled={busy}>{t("instances.send")}</Button>
    </form>
  );
}
