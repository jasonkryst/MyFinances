# Security Practices for MyFinances

## Overview

MyFinances is a self-hosted personal finance tracking application with strong security practices: a browser frontend backed by your own Node.js + PostgreSQL server. This document outlines the security measures implemented and best practices for deployment and usage.

## Security Architecture

### Self-Hosted Server Storage (since 7.0.0)
- **Your server only**: All financial data is stored in your own PostgreSQL server; the browser talks only to that server (same origin) and to the Chart.js CDN
- **No financial data in browser storage**: Only device preferences (theme, language, currency, What's New version) live in `localStorage`; since 8.2.0 Ledger hidden columns and unfinished-reconciliation drafts are stored on the server (#587). `tests/security/test_no_browser_financial_storage.py` enforces this allowlist statically
- **No cached API responses**: The service worker is network-only for `/api/`, `/auth/` and `/calendar.ics`, so financial data never lands in Cache Storage
- **Fails closed**: If the server cannot be reached the app shows a blocking "Can't reach your server" screen, never stale or local data

### Server Security
The Node.js + PostgreSQL server protects that data with:
- **argon2id password hashing** — industry-standard, tuned cost factors
- **Server-side sessions** — opaque tokens hashed before storage; never stored in plain text
- **httpOnly / Secure / SameSite=Strict cookies** — session token unreachable from JavaScript
- **CSRF double-submit tokens** — every mutating request requires a matching `csrf` cookie + header pair
- **Rate limiting** — sign-in, register and change-password each allow 5 failed attempts per 15 minutes (successful ones aren't counted); forgot-password and reset-password allow 5 requests per 15 minutes; the setup-status check allows 20 and the public calendar feed 60. See [Accounts and sessions](#accounts-and-sessions)
- **New-password policy** (NIST SP 800-63B rev 4) — 15–128 characters, no composition rules, rejects common, repetitive and context-based passwords on setup, reset and change; optional Have I Been Pwned k-anonymity breach check (`SECURITY_CHECK_BREACHED_PASSWORDS`, fails open); changing or resetting the password signs out other sessions. See [server/README.md](server/README.md#password-security-issue-456)
- See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and [server/README.md](server/README.md) for architecture

## Security Features

### 1. Input Validation & Sanitization

All user inputs are validated and sanitized before processing:

#### Text Input Sanitization (`normalizeText`)
```javascript
// Removes dangerous characters
// Strips: <, >, ", `, control characters
// Applied to: account names, income names, debt names, etc.
```

#### Numeric Input Validation (`sanitizeFiniteNumber`)
```javascript
// Validates numeric inputs
// Applies min/max bounds
// Prevents NaN and Infinity values
// Used for: amounts, interest rates, balances
```

#### Date Validation (`sanitizeDateISO`)
```javascript
// Strict ISO date format validation (YYYY-MM-DD)
// Regex: /^\d{4}-\d{2}-\d{2}$/
// Validates date parsing
```

#### HTML Output Encoding (`escapeHtml`)
```javascript
// Converts HTML special characters to entities:
// & → &amp;
// < → &lt;
// > → &gt;
// " → &quot;
// ' → &#39;
```

### 2. Cross-Site Scripting (XSS) Prevention

All user-provided data displayed in the DOM is HTML-encoded:

```javascript
// Safe: User data is always escaped before rendering
<span class="acct-card-name">${escapeHtml(a.name)}</span>

// Dangerous pattern (NOT USED in this codebase):
<span>${a.name}</span>  // ❌ XSS vulnerability
```

**Protection Methods:**
- Use `escapeHtml()` for all user data in innerHTML
- Use `textContent` instead of innerHTML where possible
- No dynamic script injection
- No eval() usage
- No Function() constructor usage

### 3. Content Security Policy (CSP)

Strong CSP header implemented in index.html:

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net https://www.googletagmanager.com;
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://cdn.jsdelivr.net https://www.google-analytics.com;
object-src 'none';
base-uri 'self';
form-action 'self'
```

> **Note**: `frame-ancestors 'none'` is intentionally omitted from the meta tag — browsers ignore it there per spec. Add `frame-ancestors 'none'` to the server-level CSP HTTP header (see [DEPLOYMENT.md](DEPLOYMENT.md)) alongside `X-Frame-Options: DENY` for clickjacking protection.

> **Note**: The `googletagmanager.com`/`google-analytics.com` origins support an opt-in, off-by-default Google Analytics integration for self-hosters (`GA_MEASUREMENT_ID` env var — see [DEPLOYMENT.md](DEPLOYMENT.md)'s "Google Analytics (Optional)" section). They're allow-listed unconditionally so the feature can work when configured, but nothing loads or is contacted unless you set that variable.

**Protection:**
- Restricts scripts to self, the trusted Chart.js CDN, and (only if you opt in) Google Analytics
- Prevents inline scripts
- Prevents frame embedding (clickjacking protection)
- Blocks unsafe objects/embeds
- Restricts form submissions

### 4. Data Import/Export Security

#### File Upload Protection
- **Size Limit**: Maximum 2 MB (prevents memory exhaustion)
- **Format Validation**: JSON only (via accept attribute)
- **Content Validation**: Comprehensive sanitization on import

#### Import Process
```javascript
1. File size check (MAX_IMPORT_BYTES = 2 MB)
2. JSON parsing (wrapped in try-catch)
3. Full data validation and re-sanitization
4. Type checking on all fields
5. Invalid records filtered out
```

#### Export Security
- Clean JSON export (no sensitive metadata)
- No credentials or tokens included
- User has full control over exported data

### 5. Data Storage

#### Server (PostgreSQL)
- **Every write re-sanitized**: the server re-runs the same `sanitize*` functions as the frontend before storing a record
- **Credentials**: since 8.0.0 the database and SMTP passwords are environment variables (`POSTGRES_PASSWORD`, `SMTP_PASSWORD`), usually in the deployment's `.env`. Keep that file private (`setup.sh` writes it with mode 600) and out of version control (`.gitignore` excludes it). The values are visible to anyone who can run `docker inspect` or `docker compose config` on the host, which already implies control of the containers. The server percent-encodes the database password into `DATABASE_URL` and never logs it.
- **At rest**: protect the `postgres-data` volume and any `pg_dump` backups like the data itself (dumps are not encrypted)

#### Browser Storage
- ❌ No financial data, passwords, API keys or authentication tokens in `localStorage`/`sessionStorage`
- ✅ Device preferences only (theme, language, currency, What's New version)
- The session token is an httpOnly cookie, unreadable from JavaScript; pre-7.0 browser data (`debtTrackerData`) is removed after the one-time import or download prompt

### 6. Minimal Dependencies

- **Vanilla JavaScript frontend**: No npm packages are shipped to the browser
- **One frontend library**: Chart.js from CDN (for visualization only)
- **Small server dependency set**: Express, `pg`, argon2, nodemailer, `express-rate-limit`, `cookie-parser` and `node-pg-migrate`, checked by Dependency Review and Trivy
- **Code Review Easy**: All source code is readable and auditable

## Accounts and sessions

Details for each item are in [server/README.md](server/README.md).

### Active sessions (7.28.0)
- Settings → Security lists your signed-in sessions with browser, operating system, network and last activity. You can sign out one session or all the others.
- The server stores the User-Agent (capped in length) and only the network part of the address (IPv4 /24, IPv6 /48), never the full address.
- Sessions are identified by an opaque public id. The token hash never leaves the server, and every query is scoped to the signed-in user, so another user's session id is a 404.
- A sign-in from a browser and operating system pair your account hasn't used before sends a "new sign-in" email. The first device is remembered silently. Turn it off with the `notifyNewSignIn` setting or the in-app-only notification channel. It needs SMTP (see [DEPLOYMENT.md](DEPLOYMENT.md)) and never delays or fails the sign-in.

### Read-only API tokens (7.29.0)
- Settings → Security can create personal tokens for scripts and dashboards. A token is sent as `Authorization: Bearer mft_...`.
- A token can only `GET` or `HEAD` under `/api`. It is refused on the sessions, API token and calendar token routes, and never authenticates `/auth` or `/health`.
- The raw token is shown once. The server keeps only its SHA-256 and a 12-character prefix.
- Each user can hold 25 tokens. Revoke one at any time; changing or resetting the password revokes all of them.
- A token is a bearer credential: treat it like a password and use it only over HTTPS.

### Passwords
- New passwords follow the policy summarized above. The optional breached-password check (`SECURITY_CHECK_BREACHED_PASSWORDS=true`) sends only the first 5 characters of the password's SHA-1 hash to Have I Been Pwned (k-anonymity), fails open if the service is unreachable, and never logs password data. It is off by default, so a default install makes no outbound request.

### Lockout and recovery (7.15.1)
- Email addresses are compared trimmed and case-insensitively.
- After 5 failed sign-ins in 15 minutes the app says how many minutes remain, and the server logs the event. Restarting the server clears the counter.
- Without SMTP, reset a password from the host with `docker compose run --rm server node scripts/reset-password.js`; it applies the password policy and signs out every session.
- Behind a second reverse proxy, set `TRUST_PROXY_HOPS=2`; never higher than the real number of proxies, since each extra hop lets a client forge its address.

### Change history (7.22.0)
- Every create, update and delete through the data routes, and plan-settings changes, writes a row to an audit log in the same database statement. Settings → Change history shows it.
- Not logged: no-op updates, rejected writes, foreign-key cascades, background jobs and Ledger or Forecast view filters.
- Rows older than 90 days are pruned hourly. Clear All Data empties the log.

## Deployment Security

### Adding HTTP Security Headers

When deploying MyFinances, add these HTTP security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

**Example for Different Platforms:**

#### Express.js
```javascript
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-XSS-Protection', '1; mode=block');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
```

#### Nginx
```nginx
server {
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

#### Apache
```apache
Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "DENY"
Header always set X-XSS-Protection "1; mode=block"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```

#### PowerShell HttpListener
```powershell
$context.Response.AddHeader('X-Content-Type-Options', 'nosniff')
$context.Response.AddHeader('X-Frame-Options', 'DENY')
$context.Response.AddHeader('X-XSS-Protection', '1; mode=block')
$context.Response.AddHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
```

### HTTPS Deployment

For production deployment:

1. **Use HTTPS Only**
   - Protects data in transit
   - Use valid SSL/TLS certificate
   - Redirect HTTP to HTTPS

2. **Strict-Transport-Security Header**
   ```
   Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
   ```

3. **CORS Configuration**
   - Only allow same-origin requests
   - Avoid `Access-Control-Allow-Origin: *`

## Security Best Practices for Users

### 1. Browser Security
- Keep browser updated to latest version
- Use a modern browser with CSP support
- Enable JavaScript (required for app)
- Clear browser cache/data when done on shared computers

### 2. Data Backup
- **Regular Exports**: Export data regularly as JSON backup
- **Secure Storage**: Keep backups in secure locations
- **Multiple Copies**: Maintain copies on different devices

### 3. Device Security
- Use strong device password/PIN
- Enable device encryption
- Use reputable antivirus software
- Lock device when not in use

### 4. Server Access
- Serve the stack only over HTTPS (session cookies are `Secure`)
- Sign out on shared devices; changing your password signs out every other session
- Keep the host, Docker images and backups protected; anyone with the database volume or a dump can read the data
- Leave `ALLOW_SETUP` unset except while creating the first account
- Never put the test-only variables (`TEST_BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD`) in the production stack, and never point the test suite at a production server: it wipes all data before every test
- Treat downloaded `myfinances-browser-backup-*.json` files (from the 7.0.0 legacy-data prompt) and JSON exports like the database: they hold your full financial data unencrypted

## Security Testing

The application includes automated security tests:

```bash
# Run security test suite
pytest tests/security/ -v

# Tests include:
# - XSS Prevention: HTML/script tag injection
# - CSP Compliance: No inline style or script violations
# - Input Validation: Special characters, bounds
# - Static Analysis: Code patterns, no hardcoded secrets
```

### Test Coverage
- ✓ XSS attack prevention
- ✓ Input validation and bounds checking
- ✓ Data persistence and restoration
- ✓ File import sanitization
- ✓ No console errors
- ✓ JSON format validation

## Repository & CI Governance

`main` is protected by two GitHub rulesets (issue #380, aligned with the BookWheel baseline):

| Ruleset | Enforces | Bypass |
|---|---|---|
| **Protect Default Branch - Force Push** | No force-pushes, no deletion of `main` | None, not even admins |
| **Protect Default Branch - Bypass** | Every change arrives through a pull request; required checks must pass on an up-to-date branch; CodeQL and Trivy code-scanning block new alerts of **high** or above; stale reviews are dismissed on push | Admin, **pull-request only**: an override is possible but is recorded on the PR, and direct pushes are rejected |

- **Required checks:**
  - `ci-complete`: one job in `ci.yml` that waits on every CI job and fails if any failed or was cancelled. `tests/features/test_ci_shard_coverage.py` fails CI if a job is missing from it.
  - `Analyze JavaScript` (CodeQL).
  - `trivy`: blocks fixable CRITICAL/HIGH image vulnerabilities and hardcoded secrets.
  - `dependency-review`.
- **Approvals:** the required count is 0. There is one maintainer, and GitHub doesn't allow approving your own PR. The owner reviews each PR before merging.
- **Never use the override to merge a red PR.** Fix the failure or don't merge.
- **Secret scanning and push protection** are enabled. Dependabot alerts and security updates are on.

## Vulnerability Reporting

If you discover a security vulnerability:

1. **Do not** create a public GitHub issue
2. **Do not** share vulnerability details publicly
3. **Report it privately** through [GitHub private vulnerability reporting](https://github.com/jasonkryst/MyFinances/security/advisories/new)
4. **Include** steps to reproduce and impact assessment
5. **Wait** for confirmation before public disclosure

## Security Audit Results

**Most Recent Audit**: November 27, 2026 (v8.8.6). Full report: [SECURITY_AUDIT_2026-11-27.md](docs/audit/security/SECURITY_AUDIT_2026-11-27.md). The previous audit (v7.0.0, PostgreSQL-only storage) is [SECURITY_AUDIT_2026-11-04.md](docs/audit/security/SECURITY_AUDIT_2026-11-04.md).

### Summary
- Risk Level: **LOW**
- Status: **PASSED**. No High or Medium findings; 5 Low and 3 Informational, tracked in the audit report
- Live tooling at audit time: CodeQL 0 open alerts, Trivy pass, dependency-review pass, secret scanning 0 open alerts, `tests/security/` pass
- Dependabot: 0 open alerts; code scanning: 0 open alerts; `npm audit --omit=dev`: 0 vulnerabilities (root and `server/`)

### Key Findings
- ✅ All input sanitized client-side and re-sanitized server-side on every write
- ✅ No XSS: new UI (server-unreachable gate, sync-error banner, legacy-data modal) uses `textContent`/i18n only; legacy JSON never reaches `innerHTML`
- ✅ Strong CSP, unchanged and kept in sync between `index.html` and `nginx.conf`
- ✅ Server auth: argon2id, httpOnly session cookies, CSRF double-submit, rate limiting. Required for every deployment since 7.0.0
- ✅ A write rejected with 401 is retried once after re-login; it can't double-apply, because the session check runs before any route handler
- ✅ No financial data in browser storage, enforced by static and runtime tests
- ✅ No financial data in the service-worker cache: `/api`, `/auth` and `/calendar.ics` are network-only, and the server sends `Cache-Control: no-store` on `/api` and `/auth` (this closed a pre-7.0 exposure)
- ✅ Migration 031 is static DDL; all SQL values are bound parameters

### Open Low-severity follow-ups
- #473: harden the browser-storage static scanner
- #475: test-harness session cache file permissions and atomic writes
- #477: encode the ledger-override key in its PUT/DELETE URL

Earlier reports: [docs/audit/security/](docs/audit/security/)

## Security Improvements Completed

The following previously planned enhancements are now shipped:
- ✅ **Progressive Web App (PWA)** — `sw.js` service worker for installability and app-shell caching (never caches `/api`, `/auth` or `/calendar.ics`)
- ✅ **Server-side auth** — argon2id + session cookies + CSRF, required for every deployment since 7.0.0

Remaining considerations:
- [ ] Encryption at rest for the database volume and backups (today: host/disk encryption)
- [ ] Password protection for JSON exports

## Compliance

### Standards Met
- ✓ OWASP Top 10 Mitigation
- ✓ CWE Coverage (input validation, XSS prevention)
- ✓ CSP Level 3 Implementation

### Privacy
- ✓ No data collection by default
- ✓ No tracking by default — self-hosters may opt their own instance into Google Analytics (see CSP section above)
- ✓ No external API calls beyond your own server and the Chart.js CDN, unless you enable that opt-in analytics
- ✓ Self-hosted: your data lives in your own PostgreSQL server

## Security Contacts

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/jasonkryst/MyFinances/security/advisories/new). For other security questions, use [Discussions](https://github.com/jasonkryst/MyFinances/discussions).

---

**Last Updated:** November 23, 2026  
**Version:** 1.2  
**Status:** Production-Ready
