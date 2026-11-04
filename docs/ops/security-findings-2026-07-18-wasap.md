# Security findings — Wasap-IUC on S4 — 2026-07-18

Audit run with `security-audit-runbook.md`. Target: `wasap.innovative.edu.my` (S4 `167.99.74.213`,
project `/home/emanbukh/evolution`). Scope: application code (branch `setup-evolution-whatsapp`) + live
infrastructure.

**Threat model note:** self-service signup is disabled — tenants are provisioned by a super-admin. So the
application findings below require an **already-provisioned tenant Admin** (a malicious or compromised
tenant), not an anonymous attacker. Valid for multi-tenant SaaS, ranked accordingly.

## Summary

**Remediation status (2026-07-18):** #1–#7 FIXED & deployed/verified in prod. #8 partly done
(`X-Powered-By` removed; `Content-Disposition` filename escaping still open). Code fixes in commit
`bc4a3d8`; server changes applied on S4 (SSH `00-hardening.conf`, UFW 8081 → Cloudflare-only).

| # | Sev | Type | Where | Status |
|---|-----|------|-------|--------|
| 1 | HIGH | SSRF (host-controlled) | `api/workspaces/[slug]/ai-models/route.ts` + `ai-keys` | ✅ fixed (`@evo/shared/ssrf` resolved-IP guard) |
| 2 | HIGH | SSH exposed: root + password auth, port 22 world-open | S4 `/etc/ssh/sshd_config` | ✅ fixed (key-only, root prohibit-password; verified no lockout) |
| 3 | MED‑HIGH | Plaintext Apache on `:8081` world-open (bypasses Cloudflare) | S4 UFW | ✅ fixed (8081 restricted to Cloudflare ranges; journal still up) |
| 4 | MED | Cross-tenant IDOR | `drip-campaigns/[id]/enrol/route.ts` | ✅ fixed (list ownership check) |
| 5 | MED | Invite acceptance not bound to invited email | `invitations/[token]/accept/route.ts` | ✅ fixed (email binding) |
| 6 | MED | SSRF via webhook subscription URL (no guard) | `packages/webhooks/src/io.ts` + route | ✅ fixed (guard at store + delivery) |
| 7 | MED | Missing security headers (HSTS/CSP/XFO/XCTO/Referrer/Permissions) | `apps/web` responses | ✅ fixed (`next.config.ts` headers) |
| 8 | LOW | `X-Powered-By` leak; unescaped filename in `Content-Disposition` | web | ◑ partial (`poweredByHeader:false` done; filename escaping TODO) |

---

## 1. HIGH — SSRF via AI endpoint
`ai-keys` PUT stores a workspace-Admin-supplied `endpoint`; the only guard `isSafeEndpoint` blocks the
literal metadata IP + `169.254.*` prefix but **allows `localhost`, RFC1918, and internal docker hostnames**
(`evolution-api`, `postgres-manager`). `GET /ai-models` then does `fetch(\`${endpoint}/v1/models\`)`
server-side and **returns the response body** to the caller — a reflected SSRF into the container network.
The metadata block is also bypassable via decimal/octal/IPv6-mapped encodings.
**Fix:** resolve host → reject loopback/link-local/RFC1918/ULA by resolved IP; pin to that IP (anti-rebind);
`https` only; if private Ollama is needed, use a server-side hostname allowlist. Apply at store- and fetch-time.

## 2. HIGH — SSH: root login + password auth, open to the internet
`sshd -T`: `permitrootlogin yes`, `passwordauthentication yes`; UFW `22/tcp ALLOW Anywhere`. Shared
passwords are documented in the server inventory and there are active brute-force attempts (three IPs already
DENY-listed; fail2ban is active but only reactive). Key auth already works for `emanbukh`.
**Fix:** `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no` (key-only);
retire the shared passwords; optionally restrict `22` to admin IPs. **Verify a second key session stays
connected before applying**, to avoid lockout.

## 3. MED‑HIGH — Plaintext Apache on `:8081`, world-open
`:8081` (Apache/2.4.52, redirects to `/index/en` — a Koha/library vhost) is `ALLOW Anywhere` in UFW and
answered a direct probe from a non-Cloudflare IP. It serves over **plaintext HTTP**, bypassing Cloudflare’s
TLS/WAF — any login on it transits credentials in cleartext and gets no WAF.
**Fix:** restrict `8081` in UFW to the CDN ranges (or drop it) and serve that app over TLS behind the CDN,
or bind it to `127.0.0.1` behind the reverse proxy. (Owned by the Koha stack, not Wasap — flagged per the
“all apps on all servers” scope.)

## 4. MED — Cross-tenant IDOR in drip enrol
`drip-campaigns/[id]/enrol/route.ts:24` reads `contactListMember.findMany({ where: { listId } })`.
`ContactListMember` has **no `workspaceId`** and is **not** in `TENANTED_MODELS`, so `tenantClient` injects
nothing — a supplied `listId` from **another workspace** returns that list’s members (leaks membership count;
enrols foreign contact IDs into the caller’s campaign). Only the `campaign` id is ownership-checked.
**Fix:** validate the list via the scoped client first (`db.contactList.findUnique({ where:{ id: listId }})`)
— same pattern already used in `lists/[id]/members/route.ts`.

## 5. MED — Invitation acceptance not bound to the invited email
`invitations/[token]/accept/route.ts` requires only *any* authenticated session and never checks
`session.user.email === invitation.email`. Any signed-in user holding a leaked/forwarded token joins the
workspace as `invitation.role` (up to Admin). Tokens are 24 random bytes (unguessable) — exploit needs the
token to leak, but the missing binding turns any leak into a wrong-account privilege grant.
**Fix:** require the accepting user’s email to match the invitation email (case-insensitive), else 403.

## 6. MED — SSRF via webhook subscription URL
`webhook-subscriptions` stores a URL validated only by `z.string().url()` (no SSRF guard); the delivery
worker `fetch`es it (`io.ts:88`). Body is a fixed HMAC-signed envelope and the response isn’t reflected, but
the logged `statusCode`/`error` is an internal port/host probe oracle.
**Fix:** same resolved-IP SSRF validation as #1, at create- and delivery-time; restrict scheme.

## 7. MED — Missing security headers
No `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, or `Permissions-Policy` on app responses (clickjacking + MIME-sniff + no HSTS).
**Fix:** add them in `next.config.ts` `headers()` (or the reverse proxy). Minimum: HSTS,
`X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.

## 8. LOW — Info leak / header hygiene
`X-Powered-By: Next.js` (set `poweredByHeader: false`). `media/[id]/raw` interpolates the un-sanitized stored
filename into `Content-Disposition` without escaping quotes (runtime usually neutralizes it; escape anyway).

---

## Confirmed GOOD (industry-standard controls already in place)
- **Env/secrets hidden:** `.env`, `.git`, `docker-compose.yml`, source, traversal → all `302 → sign-in`; no
  source maps. No hardcoded secrets in code; env files git-ignored.
- **Origin firewalled:** direct `80/443` to the origin IP from a non-Cloudflare address **times out** — WAF
  can’t be bypassed. UFW `Default: deny (incoming)`; `80/443` limited to Cloudflare ranges.
- **Data services not exposed:** Postgres/Redis/Evolution-API have **no host port mapping** (docker-internal
  only); app services bind `127.0.0.1` behind the proxy. fail2ban active.
- **Cookies:** `__Host-`/`__Secure-` prefixed, `HttpOnly; Secure; SameSite=Lax`.
- **Crypto:** AES-256-GCM (random IV + auth tag) for stored keys; HMAC-SHA256 `timingSafeEqual`; ingest
  webhook rejects empty/missing signatures.
- **Tenant isolation:** `tenantClient` extended-`where` scoping confirmed effective on `findUnique/update/
  delete`; no unscoped `[id]` tenant lookups except #4.
- **AuthZ:** super-admin re-checked from DB on every `/api/admin/*`; API keys argon2-hashed & per-workspace;
  server-side signup disabled; Socket.IO rooms workspace-scoped.
- **No** SQLi / eval / command-exec / template-injection / path-traversal; upload allowlist excludes HTML/SVG.

## Recommended remediation order
1. **#2 SSH** (key-only, no root) — highest exposure, actively attacked. *(verify second session first)*
2. **#3 `:8081`** — close/restrict in UFW.
3. **#1 SSRF** — resolved-IP validation on AI + webhook endpoints (covers #6).
4. **#7 headers** + **#8** — one `next.config.ts` change + redeploy.
5. **#4, #5** — small server-side ownership/email checks.
