"use client";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { BookOpen } from "lucide-react";
import { DEFAULT_GUARDRAILS } from "@evo/kb";

type Guardrails = {
  stayOnTopic: boolean;
  answerOnlyFromKnowledge: boolean;
  handoff: { enabled: boolean; triggers: string[]; onUnsure: boolean };
  neverSay: string[];
  fallbackMessage: string;
};

type Initial = {
  name: string | null;
  personaTone: string | null;
  greeting: string | null;
  guardrails: unknown;
};

type Snippet = {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  sourceLabel: string | null;
  enabled: boolean;
  chars: number;
};

const TABS = [
  { key: "persona", label: "Persona" },
  { key: "guardrails", label: "Guardrails" },
  { key: "knowledge", label: "Knowledge" },
  { key: "test", label: "Test" },
] as const;

function normalizeGuardrails(raw: unknown): Guardrails {
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object") obj = {};
  const handoff = obj.handoff && typeof obj.handoff === "object" ? obj.handoff : {};
  return {
    stayOnTopic: obj.stayOnTopic ?? DEFAULT_GUARDRAILS.stayOnTopic,
    answerOnlyFromKnowledge: obj.answerOnlyFromKnowledge ?? DEFAULT_GUARDRAILS.answerOnlyFromKnowledge,
    handoff: {
      enabled: handoff.enabled ?? false,
      triggers: Array.isArray(handoff.triggers) ? handoff.triggers : [],
      onUnsure: handoff.onUnsure ?? false,
    },
    neverSay: Array.isArray(obj.neverSay) ? obj.neverSay : [],
    fallbackMessage: obj.fallbackMessage ?? "",
  };
}

const linesToArray = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

const textareaCls =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export default function TopicEditor({
  workspaceSlug,
  topicId,
  initial,
}: {
  workspaceSlug: string;
  topicId: string;
  initial: Initial;
}) {
  const [active, setActive] = useState<(typeof TABS)[number]["key"]>("persona");
  const base = `/api/workspaces/${workspaceSlug}/topics/${topicId}`;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "persona" && <PersonaTab base={base} initial={initial} />}
      {active === "guardrails" && <GuardrailsTab base={base} initial={initial} />}
      {active === "knowledge" && <KnowledgeTab base={base} />}
      {active === "test" && <TestTab base={base} />}
    </div>
  );
}

function SavedFlag({ saved }: { saved: boolean }) {
  if (!saved) return null;
  return <span className="text-sm text-primary">Saved ✓</span>;
}

function PersonaTab({ base, initial }: { base: string; initial: Initial }) {
  const [name, setName] = useState(initial.name ?? "");
  const [personaTone, setPersonaTone] = useState(initial.personaTone ?? "");
  const [greeting, setGreeting] = useState(initial.greeting ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, personaTone, greeting }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="topic-name">Name</Label>
          <Input id="topic-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="topic-tone">Persona / tone</Label>
          <Input
            id="topic-tone"
            value={personaTone}
            onChange={(e) => setPersonaTone(e.target.value)}
            placeholder="e.g. polite, Bahasa Malaysia + English, short"
          />
          <p className="text-xs text-muted-foreground">
            How the bot should sound — language, formality, and length.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="topic-greeting">Greeting</Label>
          <textarea
            id="topic-greeting"
            className={textareaCls}
            rows={3}
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" disabled={busy} onClick={save}>
            Save
          </Button>
          <SavedFlag saved={saved} />
        </div>
      </CardContent>
    </Card>
  );
}

function GuardrailsTab({ base, initial }: { base: string; initial: Initial }) {
  const g = normalizeGuardrails(initial.guardrails);
  const [stayOnTopic, setStayOnTopic] = useState(g.stayOnTopic);
  const [answerOnly, setAnswerOnly] = useState(g.answerOnlyFromKnowledge);
  const [handoffEnabled, setHandoffEnabled] = useState(g.handoff.enabled);
  const [triggersText, setTriggersText] = useState(g.handoff.triggers.join("\n"));
  const [onUnsure, setOnUnsure] = useState(g.handoff.onUnsure);
  const [neverSayText, setNeverSayText] = useState(g.neverSay.join("\n"));
  const [fallbackMessage, setFallbackMessage] = useState(g.fallbackMessage);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    const guardrails: Guardrails = {
      stayOnTopic,
      answerOnlyFromKnowledge: answerOnly,
      handoff: {
        enabled: handoffEnabled,
        triggers: linesToArray(triggersText),
        onUnsure,
      },
      neverSay: linesToArray(neverSayText),
      fallbackMessage,
    };
    const res = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guardrails }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={stayOnTopic}
            onChange={(e) => setStayOnTopic(e.target.checked)}
          />
          <span>
            <span className="font-medium">Stay on topic</span>
            <span className="block text-xs text-muted-foreground">Politely declines off-topic questions.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={answerOnly}
            onChange={(e) => setAnswerOnly(e.target.checked)}
          />
          <span>
            <span className="font-medium">Answer only from knowledge</span>
            <span className="block text-xs text-muted-foreground">
              Stops the bot inventing fees/dates — replies with the fallback instead.
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={handoffEnabled}
              onChange={(e) => setHandoffEnabled(e.target.checked)}
            />
            <span>
              <span className="font-medium">Human handoff</span>
              <span className="block text-xs text-muted-foreground">
                Escalates the conversation to a human when needed.
              </span>
            </span>
          </label>
          {handoffEnabled && (
            <div className="ml-6 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="handoff-triggers">Trigger words (one per line)</Label>
                <textarea
                  id="handoff-triggers"
                  className={textareaCls}
                  rows={3}
                  value={triggersText}
                  onChange={(e) => setTriggersText(e.target.value)}
                  placeholder={"speak to a person\ncomplaint\nrefund"}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={onUnsure}
                  onChange={(e) => setOnUnsure(e.target.checked)}
                />
                <span className="font-medium">Hand off when unsure</span>
              </label>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="never-say">Never say (one per line)</Label>
          <textarea
            id="never-say"
            className={textareaCls}
            rows={3}
            value={neverSayText}
            onChange={(e) => setNeverSayText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Phrases the bot must never use.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fallback-message">Fallback message</Label>
          <textarea
            id="fallback-message"
            className={textareaCls}
            rows={3}
            value={fallbackMessage}
            onChange={(e) => setFallbackMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The exact text sent when it can&apos;t help / hands off.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" disabled={busy} onClick={save}>
            Save
          </Button>
          <SavedFlag saved={saved} />
        </div>
      </CardContent>
    </Card>
  );
}

function meterTier(totalTokens: number): { color: string; label: string } {
  if (totalTokens < 30000) return { color: "bg-primary", label: "Lean" };
  if (totalTokens < 120000) return { color: "bg-warning", label: "Getting large" };
  return {
    color: "bg-destructive",
    label: "Very large — costs more per reply and dilutes accuracy; prefer FAQ / trim",
  };
}

function KnowledgeTab({ base }: { base: string }) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`${base}/knowledge`);
    if (res.ok) {
      const data = await res.json();
      setSnippets(data.snippets ?? []);
      setTotalTokens(data.totalTokens ?? 0);
    }
    setLoading(false);
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  // FAQ form
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [faqBusy, setFaqBusy] = useState(false);
  async function addFaq() {
    if (!q.trim() || !a.trim()) return;
    setFaqBusy(true);
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "faq", question: q, answer: a }),
    });
    setFaqBusy(false);
    if (res.ok) {
      setQ("");
      setA("");
      load();
    }
  }

  // Paste text form
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  async function addText() {
    if (!content.trim()) return;
    setTextBusy(true);
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "text", label: label || undefined, content }),
    });
    setTextBusy(false);
    if (res.ok) {
      setLabel("");
      setContent("");
      load();
    }
  }

  // Upload
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
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setUploadError(friendlyUploadError(data?.error));
    }
  }

  async function deleteById(id: string) {
    const res = await fetch(`${base}/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load();
  }
  async function deleteByLabel(sourceLabel: string) {
    const res = await fetch(`${base}/knowledge?sourceLabel=${encodeURIComponent(sourceLabel)}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const faqs = snippets.filter((s) => s.sourceType === "faq");
  const nonFaq = snippets.filter((s) => s.sourceType !== "faq");
  const groups = new Map<string, Snippet[]>();
  for (const s of nonFaq) {
    const key = s.sourceLabel ?? "Untitled source";
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  const tier = meterTier(totalTokens);
  const pct = Math.min(100, Math.round((totalTokens / 150000) * 100));

  return (
    <div className="space-y-4">
      {/* Token meter */}
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Knowledge: ~{Math.round(totalTokens / 1000)}k tokens</span>
            <span className="text-xs text-muted-foreground">{tier.label}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full transition-all", tier.color)} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            The bot only pulls the most-relevant pieces per reply, so per-message cost stays bounded.
          </p>
        </CardContent>
      </Card>

      {/* Add cards */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            🟢 FAQ
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
              most efficient &amp; precise
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="faq-q">Question</Label>
            <Input id="faq-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="faq-a">Answer</Label>
            <textarea id="faq-a" className={textareaCls} rows={3} value={a} onChange={(e) => setA(e.target.value)} />
          </div>
          <Button type="button" size="sm" disabled={faqBusy} onClick={addFaq}>
            Add FAQ
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">🟢 Paste text</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="text-label">Label (optional)</Label>
            <Input id="text-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="text-content">Content</Label>
            <textarea
              id="text-content"
              className={textareaCls}
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" disabled={textBusy} onClick={addText}>
            Add text
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            🟡 Upload
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-normal text-warning-foreground">
              convenient, can be token-heavy — trim to what customers ask
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <input
            type="file"
            accept=".pdf,.docx"
            disabled={uploadBusy}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          {uploadBusy && <p className="text-xs text-muted-foreground">Uploading…</p>}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </CardContent>
      </Card>

      {/* Existing knowledge list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">In this topic</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : snippets.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No knowledge yet"
              description="Add an FAQ, paste text, or upload a document so the bot has something to answer from."
            />
          ) : (
            <div className="space-y-2">
              {faqs.map((f) => (
                <div key={f.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-muted-foreground">FAQ · {f.chars} chars</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete FAQ"
                    onClick={() => deleteById(f.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
              ))}
              {Array.from(groups.entries()).map(([groupLabel, items]) => {
                const chars = items.reduce((n, s) => n + s.chars, 0);
                return (
                  <div key={groupLabel} className="flex items-start justify-between gap-2 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{groupLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {items.length} chunk{items.length === 1 ? "" : "s"} · {chars} chars
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete source"
                      onClick={() => deleteByLabel(groupLabel)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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

function TestTab({ base }: { base: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [usedSnippets, setUsedSnippets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setReply(null);
    setFellBack(false);
    setUsedSnippets([]);
    const res = await fetch(`${base}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || data?.error) {
      if (data?.error === "NO_AI_CONFIG") {
        setError("Set an AI provider in Settings → Integrations → AI (Chatbot scope) first.");
      } else {
        setError("Test failed. Please try again.");
      }
      return;
    }
    setReply(data.reply ?? "");
    setFellBack(!!data.fellBack);
    setUsedSnippets(Array.isArray(data.usedSnippets) ? data.usedSnippets : []);
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="test-message">Message</Label>
          <textarea
            id="test-message"
            className={textareaCls}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask the bot something a customer would ask…"
          />
        </div>
        <Button type="button" disabled={busy} onClick={run}>
          {busy ? "Trying…" : "Try"}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {reply !== null && (
          <div className="space-y-2">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{reply}</div>
            {fellBack && (
              <p className="text-sm text-warning-foreground">⚠ Used the fallback (no matching knowledge)</p>
            )}
            {usedSnippets.length > 0 && (
              <p className="text-xs text-muted-foreground">Answered using: {usedSnippets.join(", ")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
