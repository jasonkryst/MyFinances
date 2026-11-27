# Security Audit: v8.8.6 (2026-11-27)

**Baseline:** [SECURITY_AUDIT_2026-11-04.md](SECURITY_AUDIT_2026-11-04.md) (v7.0.0). **Scope:** the surface added since then (sessions, API tokens, audit log, bulk import, jobs, notifications, password policy, routing) plus config, containers and CI.
**Method:** static code and config review, `npm audit`, `gh` alert queries. No dynamic testing, no penetration test.

## Result

**Risk level: LOW.** No High or Medium findings. 5 Low and 3 Informational, none exploitable without a prior foothold.

| Signal | 2026-11-04 | 2026-11-27 |
|---|---|---|
| `npm audit --omit=dev` (root, `server/`) | not recorded | 0 / 0 |
| Dependabot open alerts | 2 (dev-only) | 0 |
| Code-scanning open alerts | 0 | 0 |
| Outdated server deps | n/a | 3, patch/minor (`argon2`, `express-rate-limit`, `nodemailer`) |

## Reviewed and judged sound

- **Sessions.** Tokens are 32 random bytes; only the SHA-256 hash is stored (`server/src/auth/middleware.js`). Expiry is checked on every request and expired rows deleted. `last_seen_at` is throttled to one write per 5 minutes.
- **CSRF.** Double-submit cookie on every non-safe method of `/api` (`requireCsrf`), applied after authentication.
- **API tokens (#581).** `mft_` prefix, hashed at rest, GET/HEAD only, 25 per user, deny-list for `/api/sessions`, `/api/api-tokens`, `/api/calendar` that lowercases and collapses slashes before matching (`isDeniedPath`). A cookie session always wins over a Bearer header, so the two paths cannot be mixed to bypass CSRF.
- **Registration.** `ALLOW_SETUP` gate, atomic `INSERT ... WHERE NOT EXISTS`, answers 409 before any policy or breach-service call.
- **Passwords.** argon2id; `checkNewPassword()` on setup, reset and change only; HIBP check is k-anonymity, opt-in and fails open (CodeQL alert dismissed by the owner, see memory note).
- **SQL.** Every value is a bound parameter. The five places that interpolate (`crudRouter.js:55,201`, `keyedRouter.js:33,42`, `auth.js` via the `EMAIL_MATCH_SQL` constant, `notifications.js:161`) interpolate table/column names or SQL fragments that come from route definitions in code, never from a request.
- **Request limits.** 1 MB JSON body for `/api`, 25 MB only for `POST /api/import` (after the session and CSRF checks), matched by nginx per-location `client_max_body_size`. Malformed JSON now returns 400, not 500 (was PERF-14).
- **Caching.** `Cache-Control: no-store` on `/api` and `/auth`.
- **Containers.** Server runs as `node`; nginx image strips `user`, runs read-only with `cap_drop: ALL`; Trivy, CodeQL and dependency-review gate PRs.
- **Browser.** `index.html` has no inline `style=` attributes, no `tabindex > 0`, no `<img>` without `alt`. Static and runtime tests (`tests/security/`) enforce CSP, escaping and no financial data in browser storage.
- **Calendar feed.** Token-authenticated, own rate limiter, `no-store`.

## Findings

### SEC-01 (Low): `server` and `postgres` containers are less hardened than `myfinances`
`docker-compose.yml` gives the nginx service `read_only`, `cap_drop: ALL`, `no-new-privileges`. The `server` service has none of these; `postgres` has none; `backup` has only `no-new-privileges`. A code-execution bug in the API would run with the default Docker capability set.
**Fix:** add `security_opt: [no-new-privileges:true]` and `cap_drop: [ALL]` to `server` and `postgres` (Postgres needs `CHOWN`, `SETUID`, `SETGID`, `FOWNER`, `DAC_OVERRIDE` back on first start), and `read_only: true` plus a `/tmp` tmpfs on `server`. Test with `docker compose up` on a fresh volume.

### SEC-02 (Low): CSP always trusts Google Analytics hosts
`index.html:10` and every `add_header Content-Security-Policy` in `nginx.conf` allow `https://www.googletagmanager.com` (script) and `https://www.google-analytics.com` (connect) unconditionally, although GA is off unless `GA_MEASUREMENT_ID` is set (#131). A default deployment therefore trusts two third-party origins it never uses.
**Fix:** generate the two hosts into the CSP only when the variable is set (the entrypoint already writes `/tmp/env-config.js`); keep `test_csp.py` and the meta/header sync test green by testing both variants.

### SEC-03 (Low): brute-force controls are in-memory and per IP
The login limiter is 5 failed attempts per 15 minutes per IP (`routes/auth.js:37`), held in process memory, so a restart clears it, and several IPs can share a guess budget against one account. There is no per-account throttle or delay, and the authenticated `/api` has no limiter at all. Passwords are argon2id and the policy rejects weak ones, which keeps the practical risk low. TOTP (#682) would close the main gap.
**Fix (suggested):** a per-account failed-login counter in Postgres with an escalating delay, and a generous global `/api` limiter (for example 600 requests per minute per user) so a runaway script or leaked token cannot saturate the pool.

### SEC-04 (Low): Actions pinned by tag, not SHA
`.github/workflows/*.yml` use `actions/checkout@v7`, `aquasecurity/trivy-action@v0.36.0` and so on. A moved or compromised tag would run in CI with repository permissions. Dependabot (`github-actions` ecosystem) is configured.
**Fix:** pin third-party actions (`trivy-action`, `docker/*`, `browser-actions/*`) to commit SHAs with a trailing `# vX.Y.Z` comment; Dependabot can keep them current.

### SEC-05 (Low): no graceful shutdown
See [OTH-01](../other/OTHER_AUDIT_2026-11-27.md): a SIGKILL during a write can leave a client unsure whether a request applied. Row versions make a retry safe, so this is availability, not integrity.

### Informational
- **SEC-I1** CSRF tokens are compared with `!==`, not `crypto.timingSafeEqual`. The token is not a secret an attacker can probe over the network at useful precision; harmless, but the fix is one line.
- **SEC-I2** In `nginx.conf` the regex location `~* \.(css|js)$` outranks the `/api/` prefix, so an API path that ends in `.js`, `.css`, `.png` and similar is answered by nginx (404) and never reaches the server. No API route ends that way today.
- **SEC-I3** `X-XSS-Protection` is deprecated and the same six security headers are repeated in six `location` blocks. Not a vulnerability; an `include` of one headers file would remove the drift risk (the CSP sync test already guards the worst case).

## Status of the 2026-11-04 follow-ups
The open security-labelled issues today are #682 (TOTP), #640 and #642 (home-network infrastructure, see the backlog audit). The individual 2026-11-04 follow-ups were not re-verified one by one in this pass.

## Residual risk
Unchanged from the baseline: single-user model, backups on the same host by default, and operator responsibility for TLS and the reverse proxy (`DEPLOYMENT.md`).
