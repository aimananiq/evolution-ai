"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function randomPassword(len = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => alphabet[n % alphabet.length]).join("");
}

export default function CreateTenant() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerName, ownerEmail, password }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      setMsg(`✓ Created login for ${d.user.email}. Share these credentials — the tenant names their own workspace on first sign-in.`);
      setOwnerName("");
      setOwnerEmail("");
      setPassword("");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(
        d.error === "EMAIL_TAKEN"
          ? "That email already has an account."
          : "Couldn't create the tenant login. Check the fields.",
      );
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium">Create tenant</h2>
          <p className="text-xs text-muted-foreground">Provision the owner login (sign-up is disabled). The tenant names their own workspace on first sign-in.</p>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "New tenant"}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm">Owner name
            <input className="w-full border rounded p-2 mt-1" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required maxLength={100} />
          </label>
          <label className="text-sm">Owner email (login)
            <input type="email" className="w-full border rounded p-2 mt-1" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
          </label>
          <label className="text-sm">Password
            <div className="flex gap-2 mt-1">
              <input className="w-full border rounded p-2 font-mono" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              <Button type="button" variant="outline" size="sm" onClick={() => setPassword(randomPassword())} className="whitespace-nowrap">Generate</Button>
            </div>
          </label>
          <div className="col-span-2 flex items-center gap-3">
            <Button disabled={busy}>Create tenant</Button>
            {err && <span className="text-sm text-destructive">{err}</span>}
          </div>
        </form>
      )}
      {msg && <p className="mt-3 text-sm text-green-700 break-words">{msg}</p>}
      </CardContent>
    </Card>
  );
}
