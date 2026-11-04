import { timingSafeEqual } from "node:crypto";

export function verifyBearer(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
