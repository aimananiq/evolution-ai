import { prisma } from "@evo/db";

const BASE = process.env.EVOLUTION_BASE_URL;
const GKEY = process.env.EVOLUTION_GLOBAL_API_KEY;
const VALID = new Set(["open", "connecting", "close"]);

async function evolutionState(name: string): Promise<string | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${BASE}/instance/connectionState/${encodeURIComponent(name)}`, {
      headers: { apikey: GKEY as string },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { instance?: { state?: string } };
    const s = j?.instance?.state;
    return s && VALID.has(s) ? s : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/**
 * Poll Evolution for every instance's real WhatsApp session state and reconcile
 * it into the DB. Without this the app can show a dropped number as "open", so
 * the warmer/broadcasts try to send from a dead session (Evolution 500) and the
 * UI lies. Runs on the heartbeat tick. Uses the global key so no per-instance
 * decryption is needed. Concurrency-capped so it scales past a handful of numbers.
 */
export async function runInstanceStateTick(): Promise<{ checked: number; changed: number }> {
  if (!BASE || !GKEY) return { checked: 0, changed: 0 };
  const instances = await prisma.instance.findMany({ select: { id: true, evolutionInstanceName: true, connectionState: true } });
  let changed = 0;
  const CHUNK = 8;
  for (let i = 0; i < instances.length; i += CHUNK) {
    const batch = instances.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async (inst) => {
        if (!inst.evolutionInstanceName) return;
        const state = await evolutionState(inst.evolutionInstanceName);
        if (state && state !== inst.connectionState) {
          await prisma.instance.update({ where: { id: inst.id }, data: { connectionState: state as never } }).catch(() => {});
          changed++;
        }
      }),
    );
  }
  return { checked: instances.length, changed };
}
