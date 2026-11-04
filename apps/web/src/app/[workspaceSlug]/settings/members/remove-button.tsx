"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function RemoveButton({ workspaceSlug, memberId }: { workspaceSlug: string; memberId: string }) {
  const t = useTranslations();
  const router = useRouter();
  async function onClick() {
    if (!confirm(`${t("members.remove")}?`)) return;
    await fetch(`/api/workspaces/${workspaceSlug}/members/${memberId}`, { method: "DELETE" });
    router.refresh();
  }
  return <Button variant="ghost" size="sm" onClick={onClick} className="text-destructive hover:text-destructive">{t("members.remove")}</Button>;
}
