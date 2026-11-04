import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plug, ChevronRight } from "lucide-react";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";

export default async function IntegrationsHub({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Admin");
  const t = await getTranslations();
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader icon={Plug} title={t("integrations.title")} />
      <ul className="space-y-2">
        {[
          { href: `/${workspaceSlug}/settings/integrations/ai`, label: "AI provider keys" },
          { href: `/${workspaceSlug}/settings/knowledge`, label: `${t("knowledge.title")} — ${t("knowledge.subtitle")}` },
          { href: `/${workspaceSlug}/settings/integrations/chatwoot`, label: "Chatwoot (pass-through)" },
          { href: `/${workspaceSlug}/integrations/inbound`, label: "Inbound webhooks (Pabbly / Make / WooCommerce)" },
        ].map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-accent">
              <span>{item.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
