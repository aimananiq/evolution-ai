"use server";

import { signOut } from "@/lib/auth";

/** Server action: ends the Auth.js session and redirects to the sign-in page. */
export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}
