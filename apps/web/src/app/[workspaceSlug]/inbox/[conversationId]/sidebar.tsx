"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Note = { id: string; body: string; createdAt: string; userId: string };

export default function Sidebar({
  workspaceSlug, conversationId, currentStatus, assignedToUserId,
}: {
  workspaceSlug: string; conversationId: string; currentStatus: string; assignedToUserId: string | null;
}) {
  const t = useTranslations();
  const [status, setStatus] = useState(currentStatus);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [assignee, setAssignee] = useState<string | null>(assignedToUserId);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/members`).then(async (r) => {
      if (r.ok) {
        const { members } = await r.json();
        setMembers(members.map((m: any) => ({ userId: m.userId, name: m.user?.name ?? m.userId })));
      }
    });
    fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/notes`).then(async (r) => {
      if (r.ok) {
        const { notes } = await r.json();
        setNotes(notes);
      }
    });
  }, [workspaceSlug, conversationId]);

  async function updateStatus(s: string) {
    setStatus(s);
    await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/status`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s }),
    });
  }
  async function assign(userId: string | null) {
    setAssignee(userId);
    await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/assign`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }),
    });
  }
  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/workspaces/${workspaceSlug}/conversations/${conversationId}/notes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: noteText }),
    });
    if (res.ok) {
      const { note } = await res.json();
      setNotes((n) => [...n, note]);
      setNoteText("");
    }
  }

  return (
    <aside className="w-72 border-l p-4 space-y-4 overflow-y-auto">
      <div>
        <label className="block text-xs text-muted-foreground mb-1">{t("inbox.changeStatus")}</label>
        <select className="w-full border rounded p-2" value={status} onChange={(e) => updateStatus(e.target.value)}>
          <option value="open">{t("inbox.statusOpen")}</option>
          <option value="pending">{t("inbox.statusPending")}</option>
          <option value="resolved">{t("inbox.statusResolved")}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-muted-foreground mb-1">{t("inbox.assignTo")}</label>
        <select className="w-full border rounded p-2" value={assignee ?? ""} onChange={(e) => assign(e.target.value || null)}>
          <option value="">{t("inbox.unassigned")}</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.name}</option>
          ))}
        </select>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">{t("inbox.notesHeading")}</h3>
        <ul className="space-y-2 mb-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm bg-amber-500/10 p-2 rounded">{n.body}</li>
          ))}
        </ul>
        <form onSubmit={addNote} className="space-y-2">
          <textarea className="w-full border rounded p-2 text-sm" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("inbox.notePlaceholder")} rows={3} required />
          <button className="text-sm bg-primary text-primary-foreground rounded p-1 px-3">{t("inbox.addNote")}</button>
        </form>
      </div>
    </aside>
  );
}
