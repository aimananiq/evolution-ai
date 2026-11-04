"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";

interface AssetRow {
  id: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "document";
  createdAt: string;
}

interface Props {
  workspaceSlug: string;
  /** Currently selected asset id (controlled). */
  value: string | null;
  onChange: (assetId: string | null, asset: AssetRow | null) => void;
  /** Label shown on the trigger button. Defaults to "File manager". */
  label?: string;
}

function kindIcon(kind: AssetRow["kind"]): string {
  switch (kind) {
    case "image": return "🖼";
    case "video": return "🎬";
    case "audio": return "🎵";
    default: return "📄";
  }
}

export function MediaPicker({ workspaceSlug, value, onChange, label }: Props) {
  const t = useTranslations("files");
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/media`);
      if (res.ok) {
        const { assets: list } = await res.json();
        setAssets(list);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    if (open) fetchAssets();
  }, [open, fetchAssets]);

  const select = useCallback(
    (asset: AssetRow) => {
      onChange(asset.id, asset);
      setOpen(false);
    },
    [onChange]
  );

  const clear = useCallback(() => {
    onChange(null, null);
  }, [onChange]);

  const selectedAsset = value ? assets.find((a) => a.id === value) ?? null : null;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 border rounded px-3 py-1.5 text-sm bg-card hover:bg-accent"
        >
          <span>📁</span>
          {label ?? t("pickerButton")}
        </button>
        {value && selectedAsset && (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            {kindIcon(selectedAsset.kind)} {selectedAsset.filename}
            <button
              type="button"
              onClick={clear}
              className="text-muted-foreground hover:text-destructive ml-1"
              aria-label="Clear selection"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold text-lg">{t("pickerTitle")}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {loading && (
                <p className="text-sm text-muted-foreground">{t("loading")}</p>
              )}
              {!loading && assets.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              )}
              {!loading && assets.length > 0 && (
                <ul className="grid grid-cols-3 gap-3">
                  {assets.map((a) => (
                    <li
                      key={a.id}
                      onClick={() => select(a)}
                      className={`border rounded-lg overflow-hidden cursor-pointer hover:border-blue-500 transition-colors ${
                        value === a.id ? "border-blue-600 ring-2 ring-blue-200" : ""
                      }`}
                    >
                      <div className="h-24 flex items-center justify-center bg-muted">
                        {a.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/workspaces/${workspaceSlug}/media/${a.id}/raw`}
                            alt={a.filename}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-3xl">{kindIcon(a.kind)}</span>
                        )}
                      </div>
                      <p className="text-xs p-1.5 truncate" title={a.filename}>
                        {a.filename}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
