"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function CreateForm({ workspaceSlug }: { workspaceSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed");
      setBusy(false);
      return;
    }
    const { instance } = await res.json();
    router.push(`/${workspaceSlug}/instances/${instance.id}/pair`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm">{t("instances.label")}</span>
        <input
          className="w-full border rounded p-2 mt-1"
          placeholder={t("instances.labelPlaceholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={80}
        />
      </label>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={busy}>
        {t("instances.createCta")}
      </Button>
    </form>
  );
}
