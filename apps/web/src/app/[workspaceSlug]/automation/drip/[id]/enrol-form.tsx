"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function EnrolForm({ workspaceSlug, campaignId, lists }: {
  workspaceSlug: string; campaignId: string; lists: { id: string; name: string; members: number }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function enrol(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/drip-campaigns/${campaignId}/enrol`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ listId }),
    });
    setBusy(false);
    if (res.ok) {
      const { enrolled } = await res.json();
      setFeedback(`${enrolled} ${t("automation.drip.enrolledCount")}`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={enrol} className="border rounded p-3 space-y-2">
      <h2 className="font-semibold">{t("automation.drip.enrol")}</h2>
      <select className="w-full border rounded p-2" value={listId} onChange={(e) => setListId(e.target.value)} required>
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.members})</option>)}
      </select>
      <button disabled={busy} className="bg-primary text-primary-foreground rounded p-2 px-4">{t("automation.drip.enrol")}</button>
      {feedback && <p className="text-sm">{feedback}</p>}
    </form>
  );
}
