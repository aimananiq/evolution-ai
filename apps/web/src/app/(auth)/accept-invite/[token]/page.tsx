"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
    if (res.status === 403) {
      router.push(`/sign-in?next=/accept-invite/${token}`);
      return;
    }
    if (!res.ok) {
      setError(t("invite.expired"));
      setBusy(false);
      return;
    }
    const { workspaceSlug } = await res.json();
    router.push(`/${workspaceSlug}/dashboard`);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("invite.acceptTitle", { workspace: "this workspace" })}</h1>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <button disabled={busy} onClick={accept} className="w-full bg-primary text-primary-foreground rounded p-2">{t("invite.accept")}</button>
    </div>
  );
}
