"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function InviteForm({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"Admin" | "Agent" | "Viewer">("Agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    setEmail("");
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <input className="flex-1 border rounded p-2" type="email" placeholder={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <select className="border rounded p-2" value={role} onChange={(e) => setRole(e.target.value as any)}>
        <option value="Admin">{t("members.roleAdmin")}</option>
        <option value="Agent">{t("members.roleAgent")}</option>
        <option value="Viewer">{t("members.roleViewer")}</option>
      </select>
      <Button disabled={busy}>{t("common.invite")}</Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
