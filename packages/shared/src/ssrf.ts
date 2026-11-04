import { lookup } from "node:dns/promises";
import net from "node:net";

// SSRF guard. A user-supplied URL that the server will fetch must not point at an
// internal address. A string blocklist (e.g. "169.254.169.254") is insufficient —
// it's bypassable via decimal/octal/IPv6-mapped IPs and DNS names that resolve to
// internal ranges. So we resolve the host and reject by *resolved IP*.

export interface SafeUrlResult {
  ok: boolean;
  reason?: string;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) return true; // unspecified, RFC1918/8, loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918/12
  if (a === 192 && b === 168) return true; // RFC1918/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 address, in either the dotted
// form (::ffff:1.2.3.4) or the hex form Node's URL parser normalises to
// (::ffff:a9fe:a9fe). Returns null if not v4-mapped.
function mappedV4(low: string): string | null {
  const dotted = low.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1] ?? null;
  const hex = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1] ?? "0", 16);
    const lo = parseInt(hex[2] ?? "0", 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

/** True for loopback / link-local / RFC1918 / CGNAT / ULA / unspecified addresses. */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true; // loopback / unspecified
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local
    const v4 = mappedV4(low); // ::ffff: mapped IPv4 (dotted or hex form)
    if (v4) return isPrivateV4(v4);
    return false;
  }
  return true; // not a parseable IP → reject
}

/**
 * Resolve `raw` and confirm it is a public http(s) URL. Rejects non-http(s)
 * schemes, literal internal IPs, and hostnames whose A/AAAA records include any
 * internal address. `allowHosts` is an explicit opt-in escape hatch for operators
 * who deliberately point at an internal host (e.g. a self-hosted Ollama on the LAN).
 */
export async function assertPublicUrl(raw: string, allowHosts: string[] = []): Promise<SafeUrlResult> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "unsupported scheme" };

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowHosts.includes(host)) return { ok: true };

  // Literal IP host — check directly, no DNS.
  if (net.isIP(host)) return isPrivateIp(host) ? { ok: false, reason: "internal address" } : { ok: true };

  // Hostname — reject if ANY resolved address is internal (defends against a record
  // that mixes a public and an internal IP).
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "dns resolution failed" };
  }
  if (addrs.length === 0) return { ok: false, reason: "dns resolution failed" };
  for (const a of addrs) if (isPrivateIp(a.address)) return { ok: false, reason: "internal address" };
  return { ok: true };
}

/** Hosts an operator has explicitly allowed for server-side fetches (SSRF escape hatch). */
export function ssrfAllowHosts(): string[] {
  return (process.env.SSRF_ALLOW_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
