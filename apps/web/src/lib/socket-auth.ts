import { parse as parseCookie } from "cookie";
import { decode } from "@auth/core/jwt";
import { prisma } from "@evo/db";

const COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token", "next-auth.session-token"];

export async function authoriseSocket(cookieHeader: string | undefined): Promise<{ userId: string; workspaceIds: string[] } | null> {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const cookieName = COOKIE_NAMES.find((n) => cookies[n]);
  if (!cookieName) return null;
  const token = cookies[cookieName];
  if (!token) return null;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  try {
    const payload = await decode({ token, secret, salt: cookieName });
    if (!payload?.sub) return null;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: payload.sub },
      select: { workspaceId: true },
    });
    return { userId: payload.sub, workspaceIds: memberships.map((m) => m.workspaceId) };
  } catch {
    return null;
  }
}
