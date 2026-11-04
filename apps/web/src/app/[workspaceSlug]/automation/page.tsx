import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bot, Send, Workflow } from "lucide-react";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default async function AutomationHub({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader icon={Workflow} title={t("automation.title")} />
      <div className="grid gap-3">
        <Link href={`/${workspaceSlug}/automation/chatbot`} className="block">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">{t("automation.chatbots")}</p>
                <p className="text-sm text-muted-foreground">Keyword triggers + AI fallback per WhatsApp instance.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href={`/${workspaceSlug}/automation/drip`} className="block">
          <Card className="transition-colors hover:bg-accent">
            <CardContent className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Send className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">{t("automation.drip")}</p>
                <p className="text-sm text-muted-foreground">Sequence of templates sent to enrolled contacts.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
