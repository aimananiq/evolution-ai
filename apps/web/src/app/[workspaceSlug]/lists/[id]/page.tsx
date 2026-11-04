import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import ListDetail from "./list-detail";

const MEMBER_CAP = 2000;

export default async function ListDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
  const { workspaceSlug, id } = await params;
  const { workspace } = await requireMember(workspaceSlug, "Viewer");
  const db = tenantClient(workspace.id);

  const list = await db.contactList.findUnique({
    where: { id },
    include: {
      members: {
        include: { contact: { select: { id: true, name: true, phoneE164: true } } },
        take: MEMBER_CAP,
      },
      _count: { select: { members: true } },
    },
  });
  if (!list) notFound();

  const members = list.members
    .map((m) => ({ id: m.contact.id, name: m.contact.name, phoneE164: m.contact.phoneE164 }))
    .sort((a, b) => (a.name ?? a.phoneE164).localeCompare(b.name ?? b.phoneE164));

  return (
    <div className="max-w-4xl space-y-4">
      <Link href={`/${workspaceSlug}/lists`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All lists
      </Link>
      <ListDetail
        workspaceSlug={workspaceSlug}
        listId={list.id}
        initialName={list.name}
        initialMembers={members}
        totalCount={list._count.members}
        capped={list._count.members > MEMBER_CAP}
      />
    </div>
  );
}
