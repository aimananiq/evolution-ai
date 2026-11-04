"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";

function SignInForm() {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(t("auth.wrongCredentials"));
      setBusy(false);
      return;
    }
    router.push(next);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-xl font-semibold">{t("auth.signInTitle")}</h1>
      <input className="w-full border rounded p-2" type="email" placeholder={t("common.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input className="w-full border rounded p-2" type="password" placeholder={t("common.password")} value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <button disabled={busy} className="w-full bg-primary text-primary-foreground rounded p-2">{t("common.signIn")}</button>
    </form>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
