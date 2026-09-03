# SMTP Email Infrastructure + Template System

**Date:** 2026-09-03

## Summary

MyFinances has no email-sending code anywhere in the repo today, and no
scheduler. This document specs the **foundation** a future notifications
feature (bill-due reminders, low-balance alerts, etc.) will build on: SMTP
transport configuration, secure credential storage, a small template-
rendering system, and one concrete trigger (a "send test email" action) to
prove the pipeline end-to-end. It does **not** add any automatic/scheduled
notification — deciding *when* to send is a separate follow-on feature.

This is a **server-only** feature. The app's core promise — fully offline,
zero-setup, `localStorage`-only operation with no backend — is unaffected;
email sending lives entirely in the optional `server/` backend (Node +
Postgres), the same way multi-device sync does. A pure-browser deployment
simply doesn't have this feature, since browsers can't speak SMTP and
have nowhere safe to hold credentials.

## Decisions

| Question | Decision |
|---|---|
| Backend gating | Server-only, alongside the rest of the Postgres backend. No browser-side SMTP or credential handling. |
| Credential storage | Docker secret file + env vars, exactly matching the existing `postgres_password` pattern — not a DB table, not an admin UI. `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_FROM`/`SMTP_SECURE` as env vars; `SMTP_PASSWORD` from `/run/secrets/smtp_password` via `docker-entrypoint.sh`, falling back to an `SMTP_PASSWORD` env var for bare-Node local dev. |
| Optionality | Entirely optional. No SMTP env vars set → the feature is silently disabled (`isEmailConfigured()` returns false); nothing fails to start, no hard requirement anywhere. |
| Templating | Plain JS template functions (`(data) => { subject, html, text }`), no new dependency — matches the codebase's existing "plain functions over frameworks" style used throughout `sanitizers.js`/`utils.js`. |
| Transport library | `nodemailer`, added to `server/package.json`. Its built-in `jsonTransport` mode (composes the message, does no network I/O) is used for tests instead of a mocking library. |
| Test-email trigger | An authenticated API endpoint (`POST /api/notifications/test-email`), not a CLI-only script — lets an operator verify SMTP from the running app. Sends **to the logged-in user's own registered email**, looked up server-side from the session, never a client-supplied address — this is deliberate: MyFinances is single-user, and accepting an arbitrary `to` address would turn the server into an open relay reachable by anyone who can log in. |
| Welcome email | Sent automatically, best-effort, from both places a user account is created: `scripts/create-user.js` and the one-shot `POST /auth/register` setup-wizard endpoint. Failure is logged and swallowed — it must never block account creation. |
| Starter templates | Three: test/verification email, welcome/account-created email, and a generic reusable "alert" template (subject + heading + body + optional CTA button) that future notification types call with different content — built now, not wired to any trigger yet. |

## Architecture

### New directory: `server/src/email/`

```
server/src/email/
  transport.js        # builds/caches a nodemailer transporter from env; isEmailConfigured()
  send.js              # sendTemplatedEmail(to, templateName, data) — the one call site every trigger uses
  templates/
    testEmail.js        # (data) => { subject, html, text }
    welcomeEmail.js
    alertEmail.js        # generic: { heading, body, ctaLabel?, ctaUrl? } -> rendered email
```

`transport.js` builds the transporter lazily (first call, then cached) from
`process.env`. `isEmailConfigured()` is `!!process.env.SMTP_HOST`. For
tests, an explicit `_setTransportOverride(transport)` /
`_clearTransportOverride()` pair (used only from `server/test/`) swaps in a
`nodemailer.createTransport({ jsonTransport: true })` instance so tests
never touch the network or need a mocking library — the same "explicit
test-only override" shape as `resetDb()` in `test/helpers/testDb.js`.

`send.js`'s `sendTemplatedEmail(to, templateName, data)` looks up the
template module, renders it, and calls `transporter.sendMail({ from:
process.env.SMTP_FROM, to, subject, html, text })`. Throws on failure;
callers decide whether that's fatal (the test-email route) or best-effort
(welcome email).

### New route: `server/src/routes/notifications.js`

Mounted under `/api/notifications`, inside the existing `api` router in
`app.js` (so it inherits `requireSession`/`requireCsrf` from the shared
middleware already applied there).

```
POST /api/notifications/test-email
```

- Rate-limited (same shape as `auth.js`'s limiters — `express-rate-limit`,
  a small per-IP window) to prevent using it to hammer an SMTP relay.
- Looks up the caller's email via `SELECT email FROM users WHERE id =
  $1` using `req.userId` from the session — never trusts a request body.
- `isEmailConfigured() === false` → `503 { error: { code:
  'EMAIL_NOT_CONFIGURED', message: '...' } }`.
- `sendTemplatedEmail` throws → `502 { error: { code: 'EMAIL_SEND_FAILED',
  message: '...' } }`, error logged server-side (never leaks SMTP error
  detail/stack to the client, matching the existing `500` handler's
  pattern in `app.js`).
- Success → `200 { ok: true }`.

### Welcome email call sites

- `server/scripts/create-user.js`: after the `INSERT INTO users` succeeds,
  call `sendTemplatedEmail(email, 'welcome', { email })` in a `try/catch`
  that only `console.error`s on failure — never sets `process.exitCode`,
  since the user account was created successfully regardless of whether
  the email went out.
- `server/src/routes/auth.js`'s `POST /register`: same best-effort
  try/catch, fired after the session cookies are set but before the
  response is sent (fire-and-forget is not used — the request already
  awaits the DB insert, so awaiting one more async call is consistent and
  keeps error handling in one place).

### Credentials and deployment

`server/docker-entrypoint.sh` gains an SMTP secret block, structured like
the existing Postgres one but non-fatal when absent:

```sh
SMTP_SECRET_FILE="/run/secrets/smtp_password"
if [ -s "$SMTP_SECRET_FILE" ]; then
    export SMTP_PASSWORD=$(cat "$SMTP_SECRET_FILE")
fi
```

(`-s`, not `-f` — treats an existing-but-empty placeholder file the same
as "not configured," per the Deployment section below.)

`docker-compose.yml`'s `server` service gains optional env vars
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `SMTP_SECURE`, all
unset by default) and a conditional `smtp_password` secret entry:

```yaml
secrets:
  postgres_password:
    file: ${POSTGRES_SECRET_FILE:-./secrets/postgres_password.txt}
  smtp_password:
    file: ${SMTP_SECRET_FILE:-./secrets/smtp_password.txt}
```

Docker Compose requires every file a service's `secrets:` list references
to exist at `docker compose up` time, even for a feature the operator
doesn't want — so `smtp_password` is always added to the `server`
service's `secrets:` list, and `setup.sh`/`setup.ps1` always write
`secrets/smtp_password.txt`, empty when the operator declines SMTP setup.
`docker-entrypoint.sh` treats an empty (or missing) secret file the same
as "not configured" — it only exports `SMTP_PASSWORD` when the file is
non-empty. This mirrors how `secrets/postgres_password.txt` is always
generated today, just extended to a second, optional secret.

`setup.sh`/`setup.ps1` gain a new optional step after the Postgres-secret
step:

```
Configure SMTP for email notifications? [y/N]
  Host: ...
  Port [587]: ...
  Username: ...
  From address: ...
  Password: (hidden input) -> written to secrets/smtp_password.txt
```

Declining writes the empty placeholder file described above and skips
setting the env vars — `docker-entrypoint.sh` sees no non-empty secret,
`isEmailConfigured()` is false, feature is off. `.env.example` documents
the five plain env vars with the same "how this fits together" framing
the file already uses for `SESSION_TTL_DAYS`/`NODE_ENV`.

### Frontend: one Settings-modal button

The Settings modal (markup in `index.html`, wired in `src/setupWizard.js`'s
`initSettingsModal`, *not* `src/settings.js` — that module is the generic
key/value settings store, unrelated to this UI) gets a "Send test email"
button next to the existing `#settingsStoragePostgresNote`, shown/hidden
by the same `isPostgres` check that already toggles that note.

Its click handler does **not** reuse `postgresSync.js`'s `pgPost` — that
helper's shared `pgFetch` calls `showPgErrorToast()` (a fixed generic
"Sync error" message) on *any* non-2xx response, including our expected
`503 EMAIL_NOT_CONFIGURED`, which would both show the wrong message and
fight with a more specific one. Instead the handler makes its own `fetch`
(same `X-CSRF-Token`/`credentials` shape as `pgFetch`) and switches on the
response: `200` → success toast, `503` → "SMTP isn't configured on this
server" toast (distinct from a generic failure, so users aren't confused
into thinking something is broken when the operator simply never set it
up), anything else (`502`, network error) → generic failure toast. A new
`showEmailTestToast(status, message)` helper lives in `src/ui.js` next to
`showPgErrorToast`, so all toast/banner functions stay co-located.

## Testing

### `server/test/email/`

- `templates.test.js` — pure unit tests of `testEmail`/`welcomeEmail`/
  `alertEmail` render functions: correct subject, `html` contains expected
  interpolated values (e.g. email address), `text` fallback is non-empty
  and free of HTML tags.
- `transport.test.js` — using the `jsonTransport` override: `isEmailConfigured()`
  reflects `SMTP_HOST` presence; `sendTemplatedEmail` composes the correct
  `to`/`from`/`subject`/`html` and calls the transport exactly once;
  rejects with a clear error for an unknown `templateName`.

### `server/test/routes/notifications.test.js`

Following the `auth.test.js` pattern (real Express app via `createApp()`,
real Postgres via `resetDb()`/`createTestUser()`):

- No session cookie → `401` (inherited from the shared `requireSession`
  middleware, verifies the route is actually mounted behind it).
- Session present, SMTP unconfigured (default test env) → `503
  EMAIL_NOT_CONFIGURED`.
- Session present, transport override installed (`jsonTransport`) →
  `200 { ok: true }`, and the captured message's `to` equals the logged-in
  test user's email — proving the route never trusts a client-supplied
  address.
- Rate limiting: N+1th request within the window → `429`.

### `server/test/routes/auth.test.js` (extend existing file)

- `POST /register` with the transport override installed sends a welcome
  email to the new user's address; with SMTP unconfigured, registration
  still succeeds (`200`, session cookies set) — the missing email must
  never fail account creation.

### `tests/postgres/` (Playwright, existing convention)

- New `test_postgres_notifications.py`: logs in against the live
  docker-compose stack (which will need SMTP configured with a test SMTP
  sink, e.g. MailHog/Mailpit added to `docker-compose.test.yml` for this
  suite only — not part of the production compose file), clicks "Send test
  email" in Settings, asserts a success toast and that the sink received
  one message addressed to the test user.

### `tests/security/` (Python static-scan suite)

- Confirm no SMTP credential ever appears in a frontend bundle/response —
  extend the existing secret-leak static scan pattern if one already
  checks for `postgres_password`-shaped strings; otherwise note this is
  covered structurally (credentials never leave `server/`, never appear in
  any API response body) rather than needing a new scan rule.

## Out of scope (this document)

- Any automatic/scheduled notification (bill-due reminders, low-balance
  alerts, etc.) — this spec is infrastructure only. A future spec adds a
  scheduler (e.g. `node-cron`) and the trigger logic that decides *when*
  to call `sendTemplatedEmail`.
- Per-user notification preferences (opt-in/opt-out, digest frequency) —
  moot until real notification types exist.
- An admin UI for editing SMTP settings after deploy (would require DB
  storage of an encrypted secret, explicitly rejected in favor of the
  Docker-secret pattern — see Decisions table).
- Non-SMTP transports (SendGrid/SES APIs, etc.).
- Multi-user support for notifications beyond the existing single-user
  deployment model.

## Documentation updates

- `server/README.md`: new "Email notifications (optional)" section
  mirroring the existing Postgres-secret documentation style — how to
  configure, how to verify via the test-email endpoint, what happens when
  unconfigured.
- Root `.env.example`: document the five SMTP env vars.
- `DEPLOYMENT.md`: new "Email notifications" subsection under "PostgreSQL
  Backend Deployment", including the `setup.sh`/`setup.ps1` prompt and the
  manual/Portainer path (set env vars + place
  `secrets/smtp_password.txt`).
- `CLAUDE.md`: extend the "Backend service" section list with a short
  mention of `server/src/email/` alongside the existing Phase
  descriptions, so future sessions know it exists and why it's server-only.
- `CHANGELOG.md` + `APP_VERSION` bump per repo convention
  (`tests/features/test_versioning.py` enforces the two stay in sync).
