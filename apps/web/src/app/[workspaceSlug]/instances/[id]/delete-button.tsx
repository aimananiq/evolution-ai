"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export default function DeleteButton({
  workspaceSlug,
  instanceId,
}: {
  workspaceSlug: string;
  instanceId: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!confirm(t("instances.confirmDelete"))) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/instances/${instanceId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      alert("Delete failed");
      return;
    }
    router.push(`/${workspaceSlug}/instances`);
    router.refresh();
  }

  return (
    <Button onClick={onClick} disabled={busy} variant="destructive">
      <Trash2 />
      {t("instances.delete")}
    </Button>
  );
}
