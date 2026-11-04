"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export default function OnboardingForm() {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    const { workspace } = await res.json();
    router.push(`/${workspace.slug}/dashboard`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <form onSubmit={onSubmit} className="w-full max-w-md p-8 bg-card shadow rounded space-y-4">
        <h1 className="text-xl font-semibold">{t("onboarding.title")}</h1>
        <input className="w-full border rounded p-2" placeholder={t("onboarding.workspaceName")} value={name} onChange={(e) => setName(e.target.value)} required />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <button disabled={busy} className="w-full bg-primary text-primary-foreground rounded p-2">{t("onboarding.create")}</button>
      </form>
    </div>
  );
}
