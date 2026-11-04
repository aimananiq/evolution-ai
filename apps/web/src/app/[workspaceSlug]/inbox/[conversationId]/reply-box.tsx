"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

type Msg = { id: string; direction: "inbound" | "outbound"; body: string | null; sentAt: string; status: string };

export default function ReplyBox({
  workspaceSlug, conversationId, onSent,
}: { workspaceSlug: string; conversationId: string; onSent: (m: Msg) => void }) {
  const t = useTranslations();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [quickReplies, setQuickReplies] = useState<{ shortcut: string; body: string }[]>([]);

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/quick-replies`).then(async (r) => {
      if (r.ok) {
        const { items } = await r.json();
        setQuickReplies(items.map((i: any) => ({ shortcut: i.shortcut, body: i.body })));
      }
    });
  }, [workspaceSlug]);

  function maybeExpandShortcut(value: string) {
    setText(value);
    const match = quickReplies.find((q) => q.shortcut === value.trim());
    if (match) setText(match.body);
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/suggest-reply`, {
        method: "POST",
      });
      if (res.ok) {
        const { suggestion } = await res.json();
        if (suggestion) setText(suggestion);
      } else if (res.status === 400) {
        alert(t("inbox.suggestNoKey"));
      } else if (res.status === 422) {
        alert(t("inbox.suggestNoContext"));
      } else {
        alert(t("inbox.suggestFailed"));
      }
    } catch {
      alert(t("inbox.suggestFailed"));
    } finally {
      setSuggesting(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    setBusy(false);
    if (res.ok) {
      const { message } = await res.json();
      onSent({ id: message.id, direction: "outbound", body: text, sentAt: new Date().toISOString(), status: "sent" });
      setText("");
    } else if (res.status === 429) {
      alert(t("instances.throttled"));
    } else {
      alert(t("instances.sentFailed"));
    }
  }

  return (
    <form onSubmit={send} className="border-t p-3 flex gap-2">
      <button
        type="button"
        onClick={suggest}
        disabled={suggesting || busy}
        title={t("inbox.suggest")}
        aria-label={t("inbox.suggest")}
        className="flex items-center gap-1.5 rounded border px-3 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" />
        {suggesting ? t("inbox.suggesting") : t("inbox.suggest")}
      </button>
      <input
        className="flex-1 border rounded p-2"
        value={text}
        onChange={(e) => maybeExpandShortcut(e.target.value)}
        placeholder={t("inbox.replyPlaceholder")}
        required
      />
      <button disabled={busy} className="bg-primary text-primary-foreground rounded p-2 px-4">{t("inbox.send")}</button>
    </form>
  );
}
