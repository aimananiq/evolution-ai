import { getTranslations } from "next-intl/server";
import { tenantClient } from "@evo/db";
import { requireMember } from "@/lib/tenancy";
import { PageHeader } from "@/components/ui/page-header";
import { FolderOpen } from "lucide-react";
import { checkStorage } from "@evo/limits";
import FilesBrowser from "./files-browser";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireMember(workspaceSlug, "Viewer");
  const t = await getTranslations("files");
  const db = tenantClient(workspace.id);
  const [assets, folders] = await Promise.all([
    db.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        filename: true,
        mimetype: true,
        sizeBytes: true,
        kind: true,
        folderId: true,
        createdAt: true,
      },
    }),
    db.mediaFolder.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { assets: true } } },
    }),
  ]);
  const canUpload = role === "Agent" || role === "Admin" || role === "Owner";
  const canDelete = role === "Admin" || role === "Owner";
  const storage = await checkStorage(workspace.id);

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} icon={FolderOpen} />
      <FilesBrowser
        workspaceSlug={workspaceSlug}
        initialAssets={assets as any}
        initialFolders={folders.map((f) => ({ id: f.id, name: f.name, count: f._count.assets }))}
        canUpload={canUpload}
        canDelete={canDelete}
        usedBytes={storage.usedBytes}
        capMb={storage.capMb}
      />
    </div>
  );
}
