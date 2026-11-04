"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sizeLabel } from "@/lib/assistant";

type KnowledgeItem = {
  id: string;
  title: string;
  sourceType: string;
  sourceLabel: string | null;
};

const textareaCls =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function friendlyUploadError(code?: string): string {
  switch (code) {
    case "MIMETYPE_NOT_ALLOWED":
      return "That file type isn't supported. Upload a PDF or Word (.docx) file.";
    case "FILE_TOO_LARGE":
      return "That file is too large. Try a smaller document.";
    case "EMPTY_DOCUMENT":
      return "That document appears to be empty.";
    case "EXTRACT_FAILED":
      return "Couldn't read text from that file. Try a different export.";
    default:
      return "Upload failed. Please try again.";
  }
}

export function KnowledgeStep({
  workspaceSlug,
  topicId,
  knowledgeItems,
  totalTokens,
  onlyFromKnowledge,
  handoff,
  handoffMessage,
  onKnowledgeLoaded,
  onOnlyFromKnowledgeChange,
  onHandoffChange,
  onHandoffMessageChange,
  onBack,
  onNext,
}: {
  workspaceSlug: string;
  topicId: string;
  knowledgeItems: KnowledgeItem[];
  totalTokens: number;
  onlyFromKnowledge: boolean;
  handoff: boolean;
  handoffMessage: string;
  onKnowledgeLoaded: (items: KnowledgeItem[], tokens: number) => void;
  onOnlyFromKnowledgeChange: (v: boolean) => void;
  onHandoffChange: (v: boolean) => void;
  onHandoffMessageChange: (v: string) => void;
  onBack?: () => void;
  onNext?: () => void;
}) {
  const base = `/api/workspaces/${workspaceSlug}/topics/${topicId}`;
  const [loading, setLoading] = useState(false);
  const loadedOnce = useRef(false);

  const loadKnowledge = useCallback(async () => {
    const res = await fetch(`${base}/knowledge`);
    if (res.ok) {
      const data = await res.json();
      const snippets: Array<{ id: string; title: string; sourceType: string; sourceLabel: string | null }> =
        data.snippets ?? [];
      onKnowledgeLoaded(
        snippets.map((s) => ({ id: s.id, title: s.title, sourceType: s.sourceType, sourceLabel: s.sourceLabel })),
        data.totalTokens ?? 0,
      );
    }
    setLoading(false);
  }, [base, onKnowledgeLoaded]);

  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      setLoading(true);
      loadKnowledge();
    }
  }, [loadKnowledge]);

  // --- Upload PDF/Word ---
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploadBusy(true);
    setUploadError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${base}/knowledge/upload`, { method: "POST", body: fd });
    setUploadBusy(false);
    if (res.ok) {
      loadKnowledge();
    } else {
      const data = await res.json().catch(() => ({}));
      setUploadError(friendlyUploadError(data?.error));
    }
  }

  // --- Paste text ---
  const [textLabel, setTextLabel] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  async function addText() {
    if (!textContent.trim()) return;
    setTextBusy(true);
    setTextError(null);
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "text", label: textLabel || undefined, content: textContent }),
    });
    setTextBusy(false);
    if (res.ok) {
      setTextLabel("");
      setTextContent("");
      loadKnowledge();
    } else {
      setTextError("Could not save — please try again.");
    }
  }

  // --- Add FAQ ---
  const [faqQ, setFaqQ] = useState("");
  const [faqA, setFaqA] = useState("");
  const [faqBusy, setFaqBusy] = useState(false);
  const [faqError, setFaqError] = useState<string | null>(null);

  async function addFaq() {
    if (!faqQ.trim() || !faqA.trim()) return;
    setFaqBusy(true);
    setFaqError(null);
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "faq", question: faqQ, answer: faqA }),
    });
    setFaqBusy(false);
    if (res.ok) {
      setFaqQ("");
      setFaqA("");
      loadKnowledge();
    } else {
      setFaqError("Could not save — please try again.");
    }
  }

  const size = sizeLabel(totalTokens);
  const toneCls =
    size.tone === "good"
      ? "text-success"
      : size.tone === "warn"
      ? "text-warning"
      : "text-destructive";
  const barCls =
    size.tone === "good"
      ? "bg-success"
      : size.tone === "warn"
      ? "bg-warning"
      : "bg-destructive";
  const barPct = Math.min(100, Math.max(2, Math.round((totalTokens / 150000) * 100)));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Knowledge</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add what the assistant should know about.
        </p>
      </div>

      {/* Size indicator */}
      {(totalTokens > 0 || !loading) && (
        <div className="space-y-1.5">
          <p className="text-sm">
            Knowledge size:{" "}
            <span className={cn("font-semibold", toneCls)}>{size.label}</span>
            {" — "}
            <span className="text-muted-foreground">{size.hint}</span>
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width: `${barPct}%` }} />
          </div>
        </div>
      )}

      {/* Upload PDF/Word */}
      <div className="rounded-lg border border-border bg-secondary p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Upload a PDF or Word file</p>
        <p className="text-xs text-muted-foreground">
          The text will be extracted and stored as knowledge.
        </p>
        <input
          type="file"
          accept=".pdf,.docx"
          disabled={uploadBusy}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground disabled:opacity-50"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        {uploadBusy && <p className="text-xs text-muted-foreground">Uploading…</p>}
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
      </div>

      {/* Paste text */}
      <div className="rounded-lg border border-border bg-secondary p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Paste text</p>
        <p className="text-xs text-muted-foreground">
          Paste any information — product details, policies, FAQs in bulk.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="kn-text-label">
            Label <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="kn-text-label"
            value={textLabel}
            onChange={(e) => setTextLabel(e.target.value)}
            placeholder="e.g. Pricing page"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kn-text-content">Content</Label>
          <textarea
            id="kn-text-content"
            className={textareaCls}
            rows={4}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Paste your text here…"
          />
        </div>
        {textError && <p className="text-xs text-destructive">{textError}</p>}
        <Button
          type="button"
          disabled={textBusy || !textContent.trim()}
          onClick={addText}
        >
          {textBusy ? "Saving…" : "Add text"}
        </Button>
      </div>

      {/* Add Q&A */}
      <div className="rounded-lg border border-border bg-secondary p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">Add a Q&amp;A</p>
        <p className="text-xs text-muted-foreground">
          The most precise way to teach the assistant — one question, one answer.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="kn-faq-q">Question</Label>
          <Input
            id="kn-faq-q"
            value={faqQ}
            onChange={(e) => setFaqQ(e.target.value)}
            placeholder="e.g. What are your opening hours?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kn-faq-a">Answer</Label>
          <textarea
            id="kn-faq-a"
            className={textareaCls}
            rows={3}
            value={faqA}
            onChange={(e) => setFaqA(e.target.value)}
            placeholder="e.g. We're open Mon–Fri 9 am to 6 pm."
          />
        </div>
        {faqError && <p className="text-xs text-destructive">{faqError}</p>}
        <Button
          type="button"
          disabled={faqBusy || !faqQ.trim() || !faqA.trim()}
          onClick={addFaq}
        >
          {faqBusy ? "Saving…" : "Add Q&A"}
        </Button>
      </div>

      {/* Added items list */}
      {knowledgeItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Added so far</p>
          <ul className="space-y-1.5">
            {knowledgeItems.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <span className="truncate text-foreground">{item.title}</span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {item.sourceType === "faq" ? "Q&A" : item.sourceType === "text" ? "Text" : "File"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && knowledgeItems.length === 0 && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {/* Safety toggles */}
      <div className="space-y-4 rounded-lg border border-border bg-secondary p-4">
        <p className="text-sm font-medium text-foreground">Safety settings</p>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={onlyFromKnowledge}
            onChange={(e) => onOnlyFromKnowledgeChange(e.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-foreground">
              Only answer using this knowledge (don&apos;t make things up)
            </span>
            <span className="block text-xs text-muted-foreground">
              The assistant will not guess — it replies with a fallback if it doesn&apos;t know.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={handoff}
            onChange={(e) => onHandoffChange(e.target.checked)}
          />
          <span className="space-y-0.5">
            <span className="block text-sm text-foreground">
              Hand over to a human when it can&apos;t help
            </span>
            <span className="block text-xs text-muted-foreground">
              Sends a message and flags the conversation for your team.
            </span>
          </span>
        </label>

        {handoff && (
          <div className="space-y-1.5 pl-7">
            <Label htmlFor="kn-handoff-msg">Message sent to the customer</Label>
            <Input
              id="kn-handoff-msg"
              value={handoffMessage}
              onChange={(e) => onHandoffMessageChange(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Navigation */}
      {(onBack || onNext) && (
        <div className="flex items-center justify-between pt-2">
          {onBack ? (
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {onNext ? (
            <Button type="button" onClick={onNext}>
              Next
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
