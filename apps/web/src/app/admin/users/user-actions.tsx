"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function UserActions({
  userId, email, isSuperAdmin, isSelf,
}: { userId: string; email: string; isSuperAdmin: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resetPw() {
    const pw = prompt(`New password for ${email} (min 8 characters):`);
    if (!pw) return;
    if (pw.length < 8) return alert("Password must be at least 8 characters.");
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}/password`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    alert(res.ok ? "Password updated." : "Failed to update password.");
  }

  async function toggleAdmin() {
    if (isSelf && isSuperAdmin) return alert("You can't remove your own super-admin access.");
    setBusy(true);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isSuperAdmin: !isSuperAdmin }),
    });
    setBusy(false);
    router.refresh();
  }

  async function del() {
    if (!confirm(`Delete user ${email}? They lose access to all workspaces. This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert("Delete failed.");
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <Button variant="ghost" size="sm" onClick={resetPw} disabled={busy} className="text-muted-foreground">Reset password</Button>
      <Button variant="ghost" size="sm" onClick={toggleAdmin} disabled={busy || (isSelf && isSuperAdmin)} className="text-muted-foreground">
        {isSuperAdmin ? "Revoke admin" : "Make admin"}
      </Button>
      {!isSelf && (
        <Button variant="ghost" size="sm" onClick={del} disabled={busy} className="text-destructive hover:text-destructive">Delete</Button>
      )}
    </div>
  );
}
