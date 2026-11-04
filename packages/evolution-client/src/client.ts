import { EvolutionAuthError, EvolutionError, EvolutionNotFoundError, EvolutionRateLimitError } from "./errors";

export interface EvolutionClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout. A hung Baileys session otherwise blocks callers forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class EvolutionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: EvolutionClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit & { headers: Record<string, string> } = {
      method,
      headers: { apikey: this.apiKey, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e: any) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new EvolutionError(`Evolution timeout after ${this.timeoutMs}ms ${path}`, { status: 0, body: undefined });
      }
      throw e;
    }
    if (res.status === 401 || res.status === 403) {
      throw new EvolutionAuthError(`Evolution auth ${res.status}`, { status: res.status, body: await safeJson(res) });
    }
    if (res.status === 404) {
      throw new EvolutionNotFoundError(`Evolution 404 ${path}`, { status: 404, body: await safeJson(res) });
    }
    if (res.status === 429) {
      throw new EvolutionRateLimitError("Evolution 429", { status: 429, body: await safeJson(res) });
    }
    if (!res.ok) {
      throw new EvolutionError(`Evolution ${res.status} ${path}`, { status: res.status, body: await safeText(res) });
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : ({} as T)) as T;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.clone().json(); } catch { return undefined; }
}
async function safeText(res: Response): Promise<unknown> {
  try { return await res.clone().text(); } catch { return undefined; }
}
