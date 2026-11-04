import { redirect } from "next/navigation";

// Self-service sign-up is disabled — this is an internal tool. Accounts are
// created by a super-admin under /admin. Set ALLOW_SIGNUP=true to re-enable
// a public form (the original client component is in git history).
export default function SignUpDisabledPage() {
  redirect("/sign-in");
}
