/**
 * Resolve a dot-path against an arbitrary JSON value.
 * Supports nested objects and numeric array indices: "a.b", "a.0.b".
 * Returns undefined for any missing/invalid segment. Never throws.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(".");
  let cur: any = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Render a template, replacing {{a.b.c}} tokens with the stringified value at
 * that path in `payload`. Whitespace inside braces is tolerated: {{ a.b }}.
 * Missing paths render as an empty string. Non-string scalars are coerced;
 * objects/arrays are JSON.stringify'd.
 */
export function renderTemplate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^}\s][^}]*?)\s*\}\}/g, (_m, rawPath: string) => {
    const value = getByPath(payload, rawPath.trim());
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

/**
 * Normalise a raw phone string to a bare E.164-style digit string (no '+',
 * no spaces/dashes/parens). Returns null if no digits remain. If the input
 * already looks like a JID ("60123@s.whatsapp.net" / "...@g.us") it is
 * returned unchanged so group/JID recipients pass through.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/@(s\.whatsapp\.net|g\.us|lid)$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits.length >= 6 ? digits : null;
}

/**
 * Walk a sample payload and collect every leaf dot-path (and intermediate
 * array index paths) so the editor can offer variable-insert buttons.
 * Caps total paths to `limit` to avoid pathological payloads.
 */
export function collectPaths(obj: unknown, limit = 200): string[] {
  const out: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (out.length >= limit) return;
    if (node == null || typeof node !== "object") {
      if (prefix) out.push(prefix);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, prefix ? `${prefix}.${i}` : String(i)));
    } else {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    }
  };
  walk(obj, "");
  return out.slice(0, limit);
}
