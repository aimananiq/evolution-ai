import { NextResponse } from "next/server";
import { resolveAiConfig } from "@evo/ai";
import { requireMember } from "@/lib/tenancy";
import { AppError } from "@evo/shared";
import { assertPublicUrl, ssrfAllowHosts } from "@evo/shared/ssrf";

// Curated defaults for hosted providers (users can still type a custom model).
const CURATED: Record<string, string[]> = {
  claude: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  grok: ["grok-3-mini", "grok-3", "grok-4-fast"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  ollama: ["gpt-oss:20b", "gpt-oss:120b"],
};

/**
 * List selectable models for a provider. For Ollama we fetch the LIVE catalogue
 * from the configured endpoint (so it's always current); other providers return a
 * curated shortlist (a Custom option in the UI covers anything else).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "ollama";
  const scope = url.searchParams.get("scope") ?? "default";
  try {
    const { workspace } = await requireMember(slug, "Admin");

    if (provider === "ollama") {
      const cfg = await resolveAiConfig(workspace.id, scope);
      const base = (cfg?.endpoint || "https://ollama.com").replace(/\/$/, "");
      const key = cfg?.provider === "ollama" ? cfg.apiKey : null;
      // SSRF guard: this endpoint is admin-controlled and the response is returned to
      // the caller (reflected SSRF). Only fetch if it resolves to a public address;
      // otherwise fall back to the curated list.
      const safe = await assertPublicUrl(`${base}/v1/models`, ssrfAllowHosts());
      if (!safe.ok) return NextResponse.json({ models: CURATED.ollama, live: false });
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 10_000);
        const res = await fetch(`${base}/v1/models`, {
          headers: key ? { Authorization: `Bearer ${key}` } : {},
          signal: ctrl.signal,
        });
        clearTimeout(to);
        if (res.ok) {
          const json = (await res.json()) as { data?: { id?: string }[] };
          const models = (json.data ?? []).map((m) => m.id).filter(Boolean).sort();
          if (models.length) return NextResponse.json({ models, live: true });
        }
      } catch {
        /* fall back to curated */
      }
      return NextResponse.json({ models: CURATED.ollama, live: false });
    }

    return NextResponse.json({ models: CURATED[provider] ?? [], live: false });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}
