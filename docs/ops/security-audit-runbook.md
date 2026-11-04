# Security Audit Runbook — reusable across all apps & servers

> **Purpose.** A repeatable checklist to diagnose whether a deployed app/server can be
> **hacked, hijacked, or injected**, whether its **secrets/env are hidden**, and whether it
> follows **industry-standard** hardening. Run it against any app on any server by swapping
> the variables in step 0. Every step is copy-paste. It **only observes** — it changes nothing.
>
> First run: **Wasap-IUC on S4** (2026-07-18). Findings in `security-findings-2026-07-18-wasap.md`.

## 0. Set targets

```bash
DOMAIN=https://wasap.innovative.edu.my   # public URL (through CDN/WAF if any)
ORIGIN_IP=167.99.74.213                   # real server IP
SSH="ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 emanbukh@$ORIGIN_IP"  # non-root sudoer
APPDIR=/home/emanbukh/evolution           # compose project dir on the box
CURL=$(command -v curl)                    # zsh loops can drop PATH; use abs path
```

---

## 1. Secrets / env exposure  (“is the env hidden?”)

Every sensitive path must return **404 or a 3xx redirect to login** — never `200` with content.

```bash
for p in /.env /.env.local /.env.production /.git/config /.git/HEAD \
        /docker-compose.yml /package.json /next.config.ts /server.mts \
        /_next/static/chunks/../../../.env /.well-known/security.txt; do
  echo "$("$CURL" -sS -o /dev/null -w '%{http_code}' --max-time 15 "$DOMAIN$p")  $p"
done
# Source maps must not ship to prod:
"$CURL" -sS -o /dev/null -w '%{http_code}\n' "$DOMAIN/_next/static/chunks/main-app.js.map"
```
**Pass:** all non-200 (302/404). **Fail:** any `200` serving file contents → secrets/source leak.

Also confirm the repo ignores env files and no secret is committed:
```bash
git -C <repo> check-ignore .env apps/*/.env      # must print the paths (ignored)
git -C <repo> log -p -- '*.env' | head           # must be empty
grep -rInE '(api[_-]?key|secret|password|token)\s*[:=]\s*["'\''][A-Za-z0-9/_+.-]{16,}' \
     --include=*.ts --include=*.js <repo>/apps <repo>/packages   # no hardcoded secrets
```

---

## 2. HTTP security headers  (industry standard)

```bash
"$CURL" -sSI "$DOMAIN/sign-in" | grep -iE \
 '^(strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|x-powered-by|server|set-cookie)'
```
Checklist — each **should be present**:
- `Strict-Transport-Security` (HSTS, `max-age>=15552000; includeSubDomains`)
- `Content-Security-Policy` (at least `frame-ancestors 'none'`; ideally full CSP)
- `X-Frame-Options: DENY` (clickjacking)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (lock down camera/mic/geolocation)
- **Absent:** `X-Powered-By`, version-bearing `Server` (info leak — remove)

Auth/session cookies must be `HttpOnly; Secure; SameSite=Lax|Strict` (prefer `__Host-`/`__Secure-` prefixes). Confirm in the `set-cookie` lines above.

---

## 3. Network / origin exposure  (“can it be hijacked around the WAF?”)

**3a. Origin must not be reachable directly if a CDN/WAF fronts it.** From a non-CDN IP (your laptop):
```bash
"$CURL" -sS -o /dev/null -w 'https direct: %{http_code} %{time_total}s\n' \
   --resolve $(echo $DOMAIN|sed 's#https://##'):443:$ORIGIN_IP --max-time 12 "$DOMAIN/sign-in"
"$CURL" -sS -o /dev/null -w 'http  direct: %{http_code} %{time_total}s\n' --max-time 12 "http://$ORIGIN_IP/"
```
**Pass:** timeout/refused (firewall lets in only the CDN). **Fail:** `200` → WAF/DDoS bypassable.

**3b. No unexpected app/admin port is world-open:**
```bash
for port in 8080 8081 3000 5432 6379 9000; do
  "$CURL" -sS -o /dev/null -w "port $port: %{http_code} %{time_total}s\n" --max-time 8 "http://$ORIGIN_IP:$port/"
done
```
Any port that answers is directly internet-exposed (usually plaintext, no WAF) — investigate.

---

## 4. Server hardening (SSH, firewall, listeners, fail2ban)

```bash
$SSH '
echo "== firewall =="; sudo -n ufw status verbose 2>&1 | grep -iE "Status|Default|ALLOW" | head -40
echo "== publicly-bound listeners (0.0.0.0/*/::) =="; ss -tlnH | awk "{print \$4}" | grep -E "^(0\.0\.0\.0|\*|\[::\]|:::)" | sort -u
echo "== docker published ports (db/redis/upstream must NOT map to host) =="; cd '"$APPDIR"' && docker compose ps --format "table {{.Service}}\t{{.Ports}}"
echo "== SSH policy =="; sudo -n sshd -T 2>/dev/null | grep -iE "^(permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractive)"
echo "== fail2ban =="; systemctl is-active fail2ban
'
```
Industry-standard expectations:
- **UFW:** `Default: deny (incoming)`; `80/443` restricted to the CDN’s IP ranges (Cloudflare list) if a CDN fronts the app; `22` ideally restricted to known admin IPs.
- **Listeners:** DB (5432), Redis (6379), message brokers (5672/25672/4369/61613), and the upstream API must **not** be published to the host — only reachable inside the container network. In `docker compose ps` app services should bind `127.0.0.1:<port>` (fronted by the reverse proxy), never `0.0.0.0`.
- **SSH:** `PermitRootLogin no`, `PasswordAuthentication no` (key-only), `PubkeyAuthentication yes`. Rotate/retire any shared passwords.
- **fail2ban:** `active`.

---

## 5. Application code audit (hack / hijack / inject)

Run per code change (or whole tree vs `main`). Best done with parallel review agents, one per dimension. Confirm each finding by reading the cited `file:line` before reporting.

**5a. Multi-tenant isolation / IDOR** — the top risk in multi-tenant SaaS.
- Every DB call on tenant data goes through the tenant-scoped client (here `tenantClient(workspaceId)`), or validates the parent resource’s ownership first.
- Grep for raw client use that could bypass scoping, and for `[id]` lookups without a tenant filter:
```bash
grep -rInE 'prisma\.(?!workspace|user|invitation|session)' <repo>/apps/web/src/app/api   # raw prisma on tenant models
```
- **Join/child tables** (e.g. `ContactListMember`) often lack a `workspaceId` and are **not** in the tenant set — any query keyed only by a child id is unscoped. Verify the parent is ownership-checked first.

**5b. AuthN/Z & session**
- Public endpoints (`sign-up`, invite `accept`, webhook receivers) — is self-registration disabled **server-side**? Is invite acceptance **bound to the invited email**? Is every `/api/admin/*` gated by a super-admin check re-read from the DB (not the JWT)?
- API keys hashed (argon2/bcrypt), scoped per-tenant, compared constant-time. Session cookies as in §2.

**5c. Injection & execution**
```bash
grep -rInE '\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw|child_process|execSync|\beval\(|new Function\(' <repo>/apps <repo>/packages
```
Any hit on **user input** → SQLi / command / code injection. Templating must be a fixed token-replacer or an auto-escaping engine, not raw interpolation.

**5d. SSRF** — any user-supplied URL fetched server-side (AI endpoints, webhooks, integrations).
- A **blocklist** on `169.254.169.254`/`metadata.*` is insufficient: it’s bypassable via decimal/octal/IPv6-mapped IPs, DNS names resolving to internal IPs, and it still allows `localhost` + internal service hostnames.
- Correct control: **resolve the host, reject** loopback / link-local / RFC1918 / ULA by resolved IP, pin the connection to that IP (anti-rebinding), restrict scheme to `https`. Validate at store-time **and** fetch-time.

**5e. File upload / path**
- Upload allowlist must **exclude** `text/html` and `image/svg+xml` (stored XSS when served inline).
- Stored path = server-generated UUID + sanitized name; never join a user path segment onto the fs path.
- User-supplied filenames put into `Content-Disposition` must be escaped.

**5f. Crypto**
- Symmetric encryption: authenticated mode (AES-256-GCM), random per-message IV, key from env (32 bytes). HMAC comparisons `timingSafeEqual` with a length pre-check. Webhook signature verification must reject empty/missing signatures.

---

## 6. Report & remediate
- Record findings with `file:line` / host:port, severity, a concrete exploit path, and a fix. Only report ≥80%-confidence, concretely-exploitable issues — no theoretical noise.
- **Threat model matters:** if self-service signup is disabled, tenant-scoped findings require an already-provisioned tenant admin (malicious/compromised insider) — still valid, but rank accordingly.
- Fixes that can lock you out or take the site down (SSH policy, UFW, header/CSP changes) — stage on one host, verify access on a second session, then roll out.
