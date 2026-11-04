import { Prisma } from "@evo/db";

/**
 * Returns true when the error is a Prisma unique-constraint violation (P2002).
 * Works even if the error originated from a different version of @prisma/client
 * by also checking the raw `code` property as a fallback.
 */
export function isUniqueViolation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
  if (typeof (e as any)?.code === "string" && (e as any).code === "P2002") return true;
  return false;
}
