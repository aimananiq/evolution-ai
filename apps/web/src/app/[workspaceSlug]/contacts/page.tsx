import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Upload, Users } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ContactsView, type ContactRow } from "./contacts-view";

export default async function ContactsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations();
  const db = tenantClient(workspace.id);
  const contacts = await db.contact.findMany({
    include: { labels: { include: { label: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("contacts.title")}
        icon={Users}
        actions={
          <Button asChild>
            <Link href={`/${workspaceSlug}/contacts/import`}>
              <Upload className="h-4 w-4" />
              {t("contacts.import")}
            </Link>
          </Button>
        }
      />
      {contacts.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={t("contacts.noContacts")} />
        </Card>
      ) : (
        <ContactsView
          workspaceSlug={workspaceSlug}
          contacts={contacts.map(
            (c): ContactRow => ({
              id: c.id,
              name: c.name,
              phoneE164: c.phoneE164,
              customFields: (c.customFields as Record<string, string> | null) ?? null,
              labels: c.labels.map((l) => ({ labelId: l.labelId, name: l.label.name, colour: l.label.colour })),
            }),
          )}
        />
      )}
    </div>
  );
}
