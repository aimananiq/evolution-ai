import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/sign-in") ||
        pathname.startsWith("/sign-up") ||
        pathname.startsWith("/accept-invite") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/sign-up") ||
        // Public media: the WhatsApp engine fetches this server-side (no session) to
        // attach images/files. The route itself guards on the unguessable cuid asset id.
        /^\/api\/workspaces\/[^/]+\/media\/[^/]+\/raw$/.test(pathname);
      if (isPublic) return true;
      // Programmatic API access: let Bearer-key requests through to route-level
      // auth (requireMember verifies the key against argon2 hashes per workspace).
      if (
        pathname.startsWith("/api/") &&
        (request.headers.get("authorization") ?? "").startsWith("Bearer ek_")
      ) {
        return true;
      }
      if (!auth) {
        const url = new URL("/sign-in", request.nextUrl);
        url.searchParams.set("next", pathname);
        return Response.redirect(url);
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
