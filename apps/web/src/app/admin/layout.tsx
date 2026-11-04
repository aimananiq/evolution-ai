import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@evo/db";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in?next=/admin");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true, email: true, memberships: { select: { workspace: { select: { slug: true } } }, take: 1 } },
  });
  if (!user?.isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Not authorised</h1>
          <p className="text-muted-foreground">Your account does not have super-admin access.</p>
          <Link href="/" className="text-sm underline">Back to app</Link>
        </div>
      </div>
    );
  }
  const backHref = user.memberships[0]?.workspace.slug ? `/${user.memberships[0].workspace.slug}/dashboard` : "/";
  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-60 shrink-0 border-r flex flex-col">
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">Super admin</span>
        </div>
        <div className="flex-1 p-3">
          <AdminNav />
        </div>
        <div className="border-t p-3 space-y-1">
          <Link href={backHref} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-3 py-2">
            <ArrowLeft className="h-4 w-4" /> Back to app
          </Link>
          <div className="px-3 text-xs text-muted-foreground truncate" title={user.email}>{user.email}</div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
