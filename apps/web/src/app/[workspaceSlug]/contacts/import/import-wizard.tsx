"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ERROR_TEXT: Record<string, string> = {
  NO_VALID_ROWS: "No valid phone numbers found. Make sure each line has a phone number (e.g. 60123456789 or +60123456789).",
  CSV_PARSE: "Couldn't read that as a table — check the file is comma-separated.",
  EVOLUTION_NOT_CONFIGURED: "Number validation isn't available right now — untick “Validate numbers” to import anyway.",
  VALIDATION: "Something in the request wasn't right. Please try again.",
};

export default function ImportWizard({ workspaceSlug, instances }: { workspaceSlug: string; instances: { id: string; label: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [validate, setValidate] = useState(true);
  const [listName, setListName] = useState("");
  const [existingLists, setExistingLists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{ candidates: number; surviving: number; inserted: number; listError?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceSlug}/lists`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.lists)) setExistingLists(d.lists.map((l: { name: string }) => l.name));
      })
      .catch(() => { /* non-critical */ });
  }, [workspaceSlug]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const readXlsxFile = (await import("read-excel-file/browser")).default;
        const raw = (await readXlsxFile(file)) as unknown;
        // read-excel-file returns a flat 2-D array for a single sheet, or
        // [{ sheet, data }] for some (multi-sheet) files — normalise both to a grid.
        const grid: unknown[][] =
          Array.isArray(raw) && raw.length > 0 && Array.isArray((raw as unknown[])[0])
            ? (raw as unknown[][])
            : ((raw as { data?: unknown[][] }[] | undefined)?.[0]?.data ?? []);
        if (grid.length === 0) throw new Error("empty");
        const csvText = grid
          .map((r) => (r as unknown[]).map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
          .join("\n");
        setCsv(csvText);
      } else {
        setCsv(await file.text());
      }
      setFileName(file.name);
    } catch {
      setError("Could not read that file. Please use a .csv or .xlsx file.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch(`/api/workspaces/${workspaceSlug}/contacts/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, csv, validate, listName: listName.trim() || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(ERROR_TEXT[body.error as string] ?? body.error ?? "Import failed.");
      return;
    }
    setResult(await res.json());
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-sm">{t("contacts.importWizard.pickInstance")}</span>
        <select className="w-full border border-border rounded p-2 mt-1 bg-background" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} required>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      {/* Upload a file — fills the editable box below */}
      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/70">
          <Upload className="h-4 w-4" />
          Upload CSV or Excel file
          <input type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={onFile} />
        </label>
        {fileName && <span className="ml-3 text-xs text-muted-foreground">Loaded: {fileName}</span>}
        <p className="mt-1 text-xs text-muted-foreground">
          Or paste below. A header row is optional — one contact per line as <code className="rounded bg-muted px-1">phone,name</code> (e.g. <code className="rounded bg-muted px-1">60123456789,Aisha</code>). The <code className="rounded bg-muted px-1">+</code> is fine.
        </p>
      </div>

      <textarea
        className="w-full border border-border rounded p-2 font-mono text-sm bg-background"
        rows={10}
        placeholder="60123456789,Aisha&#10;60198765432,Daniel&#10;+60193067307,Aliya"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        required
        maxLength={2_000_000}
      />
      <label className="block">
        <span className="text-sm font-medium">Add these contacts to a list (optional)</span>
        <input
          list="existing-lists"
          className="w-full border border-border rounded p-2 mt-1 bg-background text-sm"
          placeholder="Type a list name or pick an existing one…"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          maxLength={120}
        />
        <datalist id="existing-lists">
          {existingLists.map((name) => <option key={name} value={name} />)}
        </datalist>
        <p className="mt-1 text-xs text-muted-foreground">
          Leave blank to import to the general pool only. Enter a new name to create a list automatically.
        </p>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
        {validate ? t("contacts.importWizard.validate") : t("contacts.importWizard.skipValidation")}
      </label>
      <p className="text-xs text-muted-foreground">
        “Validate numbers” checks each number is on WhatsApp using the selected number — it must be connected. If 0 import, untick this.
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Importing…" : t("contacts.import")}</Button>
      {result && (
        <Card>
          <CardContent className="p-3 text-sm">
            <div>{t("contacts.importWizard.candidates")}: <strong>{result.candidates}</strong></div>
            <div>{t("contacts.importWizard.surviving")}: <strong>{result.surviving}</strong></div>
            <div>{t("contacts.importWizard.inserted")}: <strong>{result.inserted}</strong></div>
            {validate && result.surviving < result.candidates && (
              <p className="mt-1 text-xs text-muted-foreground">
                {result.candidates - result.surviving} number(s) weren’t on WhatsApp and were skipped.
              </p>
            )}
            {result.listError && (
              <p className="mt-1 text-xs text-destructive">
                Contacts imported but could not be added to the list: {result.listError}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </form>
  );
}
