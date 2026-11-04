"use client";

import { useTranslations } from "next-intl";
import { useState, useRef, useCallback, useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetRow {
  id: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "document";
  folderId: string | null;
  createdAt: string;
}
interface Folder {
  id: string;
  name: string;
  count: number;
}

interface Props {
  workspaceSlug: string;
  initialAssets: AssetRow[];
  initialFolders: Folder[];
  canUpload: boolean;
  canDelete: boolean;
  usedBytes: number;
  capMb: number; // 0 = unlimited
}

function kindIcon(kind: AssetRow["kind"]): string {
  switch (kind) {
    case "image": return "🖼";
    case "video": return "🎬";
    case "audio": return "🎵";
    default: return "📄";
  }
}

export default function FilesBrowser({
  workspaceSlug, initialAssets, initialFolders, canUpload, canDelete, usedBytes, capMb,
}: Props) {
  const t = useTranslations("files");
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [selected, setSelected] = useState<string>("all"); // "all" | folder id
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const media = `/api/workspaces/${workspaceSlug}/media`;
  const selectedFolder = folders.find((f) => f.id === selected);
  const uploadTarget = selected === "all" ? "root" : selected;

  const shown = useMemo(
    () => (selected === "all" ? assets : assets.filter((a) => a.folderId === selected)),
    [assets, selected],
  );
  const countFor = (id: string) => assets.filter((a) => a.folderId === id).length;
  // Live usage from the loaded assets (updates as you upload/delete).
  const usedNow = assets.reduce((s, a) => s + a.sizeBytes, 0) || usedBytes;
  const usedMb = usedNow / (1024 * 1024);
  const pct = capMb > 0 ? Math.min(100, (usedMb / capMb) * 100) : 0;

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          const fd = new FormData();
          fd.append("file", file);
          if (uploadTarget !== "root") fd.append("folderId", uploadTarget);
          const res = await fetch(media, { method: "POST", body: fd });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError(
              body.error === "STORAGE_CAP_REACHED"
                ? `Storage limit reached${capMb > 0 ? ` (${capMb} MB)` : ""}. Delete some files, or ask an admin to raise this plan's storage cap.`
                : body.error === "FILE_TOO_LARGE"
                  ? "That file is too large (max 16 MB)."
                  : body.error ?? t("uploadError"),
            );
            continue;
          }
          const { asset } = await res.json();
          setAssets((prev) => [asset, ...prev]);
        }
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [media, uploadTarget, t, capMb],
  );

  const deleteAsset = useCallback(
    async (id: string) => {
      if (!confirm(t("deleteConfirm"))) return;
      const res = await fetch(`${media}/${id}`, { method: "DELETE" });
      if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
    },
    [media, t],
  );

  const moveAsset = useCallback(
    async (id: string, folderId: string) => {
      const target = folderId === "root" ? null : folderId;
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, folderId: target } : a)));
      await fetch(`${media}/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderId: target }),
      });
    },
    [media],
  );

  async function newFolder() {
    const name = prompt("New folder name:");
    if (!name || !name.trim()) return;
    const res = await fetch(`${media}/folders`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error === "FOLDER_EXISTS" ? "A folder with that name already exists." : "Couldn't create folder.");
      return;
    }
    const { folder } = await res.json();
    setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
    setSelected(folder.id);
  }

  async function deleteFolder() {
    if (!selectedFolder) return;
    if (!confirm(`Delete folder "${selectedFolder.name}"? Its files move back to All files (they are not deleted).`)) return;
    const res = await fetch(`${media}/folders/${selectedFolder.id}`, { method: "DELETE" });
    if (res.ok) {
      const id = selectedFolder.id;
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setAssets((prev) => prev.map((a) => (a.folderId === id ? { ...a, folderId: null } : a)));
      setSelected("all");
    }
  }

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); upload(e.dataTransfer.files); }, [upload]);

  return (
    <div className="space-y-4">
      {/* Folder bar */}
      <div className="flex flex-wrap items-center gap-2">
        <FolderChip active={selected === "all"} label={`All files (${assets.length})`} onClick={() => setSelected("all")} />
        {folders.map((f) => (
          <FolderChip key={f.id} active={selected === f.id} label={`${f.name} (${countFor(f.id)})`} onClick={() => setSelected(f.id)} />
        ))}
        {canUpload && (
          <button onClick={newFolder} className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40">
            <FolderPlus className="h-3.5 w-3.5" /> New folder
          </button>
        )}
        {selectedFolder && canDelete && (
          <button onClick={deleteFolder} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
            <Trash2 className="h-3.5 w-3.5" /> Delete folder
          </button>
        )}
        {/* Storage usage */}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {capMb > 0 ? (
            <>
              <span className={cn(pct >= 100 && "text-destructive font-medium")}>{usedMb.toFixed(1)} / {capMb} MB</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full", pct >= 90 ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
              </span>
            </>
          ) : (
            <span>{usedMb.toFixed(1)} MB used</span>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/40 rounded p-2">{error}</p>
      )}

      {canUpload && (
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-border/70 transition-colors"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <p className="text-muted-foreground text-sm">{uploading ? t("uploading") : t("dropzone")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Uploading to: <span className="font-medium text-foreground">{selectedFolder ? selectedFolder.name : "All files"}</span>
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/mp4,video/3gpp,audio/mpeg,audio/ogg,audio/mp4,audio/aac,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border">
          <EmptyState icon={FolderOpen} title={selected === "all" ? t("empty") : "This folder is empty"} />
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {shown.map((a) => (
            <li key={a.id} className="border rounded-lg overflow-hidden bg-card shadow-sm flex flex-col">
              <div className="h-28 flex items-center justify-center bg-muted">
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${media}/${a.id}/raw`} alt={a.filename} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-4xl">{kindIcon(a.kind)}</span>
                )}
              </div>
              <div className="p-2 flex flex-col gap-1 flex-1">
                <p className="text-xs font-medium truncate" title={a.filename}>{a.filename}</p>
                <p className="text-xs text-muted-foreground">{(a.sizeBytes / 1024).toFixed(0)} KB</p>
                {canUpload && (
                  <select
                    value={a.folderId ?? "root"}
                    onChange={(e) => moveAsset(a.id, e.target.value)}
                    className="mt-1 w-full rounded border bg-background px-1 py-0.5 text-xs text-muted-foreground"
                    title="Move to folder"
                  >
                    <option value="root">All files (no folder)</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
                <div className="flex gap-1 mt-auto pt-1">
                  <a href={`${media}/${a.id}/raw`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">{t("view")}</a>
                  {canDelete && (
                    <button onClick={() => deleteAsset(a.id)} className="text-xs text-destructive hover:underline ml-auto">{t("delete")}</button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FolderChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
      )}
    >
      <FolderOpen className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
