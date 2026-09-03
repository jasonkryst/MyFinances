# SMTP Email Infrastructure + Template System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only SMTP email foundation (transport config, secure credential storage, a plain-JS template system, and one working trigger — a "send test email" action) that a future scheduled-notifications feature will build on.

**Architecture:** `server/src/email/` holds a lazily-built `nodemailer` transport (test-overridable, so no network I/O in tests), three template-render functions, and a single `sendTemplatedEmail()` call site. A new authenticated `POST /api/notifications/test-email` route and a best-effort welcome email on account creation are the two callers. Credentials follow the exact Docker-secret pattern already used for `postgres_password`. A small Settings-modal button in the frontend is the only browser-side change.

**Tech Stack:** Node.js + Express + `nodemailer` (server/), `node:test` (server tests), plain vanilla JS (frontend), Playwright/pytest (`tests/postgres/`), Docker Compose secrets.

**Spec:** `docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`

## Global Constraints

- Server-only feature — no browser-side SMTP or credential handling; the pure-`localStorage` app is unaffected.
- Entirely optional — no SMTP env vars set means `isEmailConfigured()` is `false` and nothing fails to start or throws unexpectedly.
- Credentials via Docker secret file (`secrets/smtp_password.txt` → `/run/secrets/smtp_password`) + plain env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `SMTP_SECURE`), mirroring `postgres_password` exactly.
- Templates are plain `(data) => { subject, html, text }` functions — no templating library dependency.
- `POST /api/notifications/test-email` sends only to the logged-in user's own email (looked up server-side from `req.userId`) — never a client-supplied address.
- Tests never touch real SMTP/network — use `server/src/email/transport.js`'s test-only override hooks or a hand-rolled recording fake transport object.
- `node:test` server tests follow this repo's existing flat-file convention under `server/test/` (no new subdirectories) and its `--test-concurrency=1` serial execution (already in `server/package.json`).
- Every version bump (`src/utils.js` `APP_VERSION`, `sw.js` `CACHE_NAME`) must land with a matching `CHANGELOG.md` entry in the exact `## [x.y.z] — YYYY-MM-DD` heading format `tests/features/test_versioning.py` enforces.

---

## Task 1: SMTP transport module

**Files:**
- Modify: `server/package.json` (add `nodemailer` dependency)
- Create: `server/src/email/transport.js`
- Test: `server/test/emailTransport.test.js`

**Interfaces:**
- Produces: `isEmailConfigured(): boolean`, `getTransport(): Transporter`, `_setTransportOverride(transport): void`, `_clearTransportOverride(): void` — all named exports of `server/src/email/transport.js`.

- [ ] **Step 1: Add the `nodemailer` dependency**

In `server/package.json`, insert into `dependencies` (keeping the existing alphabetical order — `node-pg-migrate`, then `nodemailer`, then `pg`):

```json
    "node-pg-migrate": "^7.6.1",
    "nodemailer": "^6.9.0",
    "pg": "^8.13.1"
```

Run `npm install` inside `server/` to update `server/package-lock.json`.

- [ ] **Step 2: Write the failing test**

Create `server/test/emailTransport.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {
    isEmailConfigured,
    getTransport,
    _setTransportOverride,
    _clearTransportOverride
} from '../src/email/transport.js';

let originalHost;

beforeEach(() => {
    originalHost = process.env.SMTP_HOST;
});

afterEach(() => {
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    _clearTransportOverride();
});

test('isEmailConfigured is false when SMTP_HOST is unset', () => {
    delete process.env.SMTP_HOST;
    assert.equal(isEmailConfigured(), false);
});

test('isEmailConfigured is true when SMTP_HOST is set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    assert.equal(isEmailConfigured(), true);
});

test('getTransport builds a real transporter with sendMail when no override is set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const transport = getTransport();
    assert.equal(typeof transport.sendMail, 'function');
});

test('getTransport returns the override once one is set, and stops once cleared', () => {
    const fake = nodemailer.createTransport({ jsonTransport: true });
    _setTransportOverride(fake);
    assert.equal(getTransport(), fake);
    _clearTransportOverride();
    assert.notEqual(getTransport(), fake);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern=emailTransport 2>&1 || node --test test/emailTransport.test.js`
Expected: FAIL — `Cannot find module '../src/email/transport.js'`

- [ ] **Step 4: Write the implementation**

Create `server/src/email/transport.js`:

```js
import nodemailer from 'nodemailer';

let transporter = null;
let transportOverride = null;

function buildTransporter() {
    const auth = process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth
    });
}

export function isEmailConfigured() {
    return Boolean(process.env.SMTP_HOST);
}

export function getTransport() {
    if (transportOverride) return transportOverride;
    if (!transporter) transporter = buildTransporter();
    return transporter;
}

// Test-only: swaps in a fake/no-network transport (e.g. nodemailer's
// jsonTransport, or a hand-rolled recording object) so tests never touch
// the network. Never called from application code.
export function _setTransportOverride(transport) {
    transportOverride = transport;
}

export function _clearTransportOverride() {
    transportOverride = null;
    transporter = null;
}
```

`_clearTransportOverride` also resets the cached real `transporter` so a later test that changes `SMTP_HOST` doesn't get a stale cached instance built under a different env.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && node --test test/emailTransport.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
cd server && npm install
git add server/package.json server/package-lock.json server/src/email/transport.js server/test/emailTransport.test.js
git commit -m "feat(server): add SMTP transport module with test-only override hooks"
```

---

## Task 2: Email templates

**Files:**
- Create: `server/src/email/templates/testEmail.js`
- Create: `server/src/email/templates/welcomeEmail.js`
- Create: `server/src/email/templates/alertEmail.js`
- Test: `server/test/emailTemplates.test.js`

**Interfaces:**
- Consumes: `escapeHtml(value: string): string` — already re-exported by `server/src/sanitizers/index.js` (which re-exports `src/utils.js`).
- Produces: three default-exported render functions, each `(data?: object) => { subject: string, html: string, text: string }`:
  - `testEmail.js`: `(data?: { to?: string })`
  - `welcomeEmail.js`: `(data?: { email?: string })`
  - `alertEmail.js`: `(data?: { heading?: string, body?: string, ctaLabel?: string, ctaUrl?: string })`

- [ ] **Step 1: Write the failing tests**

Create `server/test/emailTemplates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import testEmail from '../src/email/templates/testEmail.js';
import welcomeEmail from '../src/email/templates/welcomeEmail.js';
import alertEmail from '../src/email/templates/alertEmail.js';

test('testEmail renders a fixed subject and mentions the recipient', () => {
    const { subject, html, text } = testEmail({ to: 'user@example.com' });
    assert.equal(subject, 'MyFinances: SMTP test email');
    assert.ok(html.includes('user@example.com'));
    assert.ok(text.length > 0);
    assert.ok(!text.includes('<'));
});

test('testEmail works with no data at all', () => {
    const { subject, html } = testEmail();
    assert.equal(subject, 'MyFinances: SMTP test email');
    assert.ok(html.length > 0);
});

test('welcomeEmail includes the account email and escapes HTML-unsafe input', () => {
    const { subject, html, text } = welcomeEmail({ email: '<script>alert(1)</script>@example.com' });
    assert.equal(subject, 'Welcome to MyFinances');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(text.includes('<script>')); // plain text needs no escaping
});

test('alertEmail omits the CTA button when no ctaUrl is given', () => {
    const { html, text } = alertEmail({ heading: 'Low balance', body: 'Checking is under $50.' });
    assert.equal(html.includes('<a '), false);
    assert.ok(html.includes('Low balance'));
    assert.ok(text.includes('Checking is under $50.'));
});

test('alertEmail includes a CTA link when both ctaLabel and ctaUrl are given', () => {
    const { html, text } = alertEmail({
        heading: 'Low balance',
        body: 'Checking is under $50.',
        ctaLabel: 'View account',
        ctaUrl: 'https://example.com/accounts/1'
    });
    assert.ok(html.includes('https://example.com/accounts/1'));
    assert.ok(html.includes('View account'));
    assert.ok(text.includes('https://example.com/accounts/1'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/emailTemplates.test.js`
Expected: FAIL — cannot find the template modules

- [ ] **Step 3: Write the implementation**

Create `server/src/email/templates/testEmail.js`:

```js
import { escapeHtml } from '../../sanitizers/index.js';

export default function testEmail({ to } = {}) {
    const safeTo = to ? escapeHtml(to) : '';
    return {
        subject: 'MyFinances: SMTP test email',
        html: `<p>This is a test email from your MyFinances server${safeTo ? ` to confirm delivery to <strong>${safeTo}</strong>` : ''}. If you received this, your SMTP configuration is working.</p>`,
        text: 'This is a test email from your MyFinances server. If you received this, your SMTP configuration is working.'
    };
}
```

Create `server/src/email/templates/welcomeEmail.js`:

```js
import { escapeHtml } from '../../sanitizers/index.js';

export default function welcomeEmail({ email } = {}) {
    const safeEmail = escapeHtml(email || '');
    return {
        subject: 'Welcome to MyFinances',
        html: `<p>Your MyFinances account (<strong>${safeEmail}</strong>) has been created. You can now log in and start tracking your finances.</p>`,
        text: `Your MyFinances account (${email || ''}) has been created. You can now log in and start tracking your finances.`
    };
}
```

Create `server/src/email/templates/alertEmail.js`:

```js
import { escapeHtml } from '../../sanitizers/index.js';

export default function alertEmail({ heading, body, ctaLabel, ctaUrl } = {}) {
    const safeHeading = escapeHtml(heading || 'MyFinances Alert');
    const safeBody = escapeHtml(body || '');
    const hasCta = Boolean(ctaLabel && ctaUrl);
    const ctaHtml = hasCta
        ? `<p><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(ctaLabel)}</a></p>`
        : '';
    return {
        subject: safeHeading,
        html: `<h2>${safeHeading}</h2><p>${safeBody}</p>${ctaHtml}`,
        text: `${heading || 'MyFinances Alert'}\n\n${body || ''}${hasCta ? `\n\n${ctaLabel}: ${ctaUrl}` : ''}`
    };
}
```

(Inline `style` attributes are fine here — this HTML is only ever rendered by an email client, never by the browser app, so the CSP's `style-src 'self'` restriction in `index.html` doesn't apply.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/emailTemplates.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/email/templates server/test/emailTemplates.test.js
git commit -m "feat(server): add testEmail/welcomeEmail/alertEmail templates"
```

---

## Task 3: `sendTemplatedEmail`

**Files:**
- Create: `server/src/email/send.js`
- Test: `server/test/emailSend.test.js`

**Interfaces:**
- Consumes: `isEmailConfigured`, `getTransport` from `./transport.js` (Task 1); the three template default exports (Task 2).
- Produces: `sendTemplatedEmail(to: string, templateName: 'testEmail' | 'welcomeEmail' | 'alertEmail', data?: object): Promise<info>` — named export of `server/src/email/send.js`. Throws `Error('SMTP is not configured')` when `isEmailConfigured()` is false, or `Error('Unknown email template: <name>')` for an unrecognized name.

- [ ] **Step 1: Write the failing test**

Create `server/test/emailSend.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
import { sendTemplatedEmail } from '../src/email/send.js';

function createRecordingTransport() {
    const sent = [];
    return {
        sendMail: async (mailOptions) => {
            sent.push(mailOptions);
            return { messageId: 'test-message-id' };
        },
        sent
    };
}

let originalHost, originalFrom, transport;

before(() => {
    originalHost = process.env.SMTP_HOST;
    originalFrom = process.env.SMTP_FROM;
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    transport = createRecordingTransport();
    _setTransportOverride(transport);
});

after(() => {
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = originalFrom;
    _clearTransportOverride();
});

test('sendTemplatedEmail renders the named template and calls sendMail with it', async () => {
    await sendTemplatedEmail('user@example.com', 'testEmail', { to: 'user@example.com' });
    assert.equal(transport.sent.length, 1);
    const mail = transport.sent[0];
    assert.equal(mail.from, 'noreply@myfinances.test');
    assert.equal(mail.to, 'user@example.com');
    assert.equal(mail.subject, 'MyFinances: SMTP test email');
    assert.ok(mail.html.length > 0);
    assert.ok(mail.text.length > 0);
});

test('sendTemplatedEmail rejects an unknown template name', async () => {
    await assert.rejects(
        () => sendTemplatedEmail('user@example.com', 'nope', {}),
        /Unknown email template: nope/
    );
});

test('sendTemplatedEmail rejects when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    await assert.rejects(
        () => sendTemplatedEmail('user@example.com', 'testEmail', {}),
        /SMTP is not configured/
    );
    process.env.SMTP_HOST = 'smtp.example.com';
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/emailSend.test.js`
Expected: FAIL — `Cannot find module '../src/email/send.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/email/send.js`:

```js
import { getTransport, isEmailConfigured } from './transport.js';
import testEmail from './templates/testEmail.js';
import welcomeEmail from './templates/welcomeEmail.js';
import alertEmail from './templates/alertEmail.js';

const TEMPLATES = { testEmail, welcomeEmail, alertEmail };

export async function sendTemplatedEmail(to, templateName, data = {}) {
    if (!isEmailConfigured()) {
        throw new Error('SMTP is not configured');
    }
    const template = TEMPLATES[templateName];
    if (!template) {
        throw new Error(`Unknown email template: ${templateName}`);
    }
    const { subject, html, text } = template(data);
    const transport = getTransport();
    return transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test test/emailSend.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/email/send.js server/test/emailSend.test.js
git commit -m "feat(server): add sendTemplatedEmail, the single email call site"
```

---

## Task 4: `POST /api/notifications/test-email` route

**Files:**
- Create: `server/src/routes/notifications.js`
- Modify: `server/src/app.js`
- Test: `server/test/notifications.test.js`

**Interfaces:**
- Consumes: `sendTemplatedEmail` (Task 3), `isEmailConfigured` (Task 1), `query` from `server/src/db.js`, `_setTransportOverride`/`_clearTransportOverride` (Task 1, tests only).
- Produces: `createNotificationsRouter(): express.Router` — default export of `server/src/routes/notifications.js`, mounted at `/api/notifications` inside `app.js`'s existing `api` router (so it inherits `requireSession`/`requireCsrf`). Route: `POST /api/notifications/test-email`.

- [ ] **Step 1: Write the failing test**

Create `server/test/notifications.test.js`:

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';

let server, baseUrl, cookies, originalHost, originalFrom;

function createRecordingTransport() {
    const sent = [];
    return { sendMail: async (mailOptions) => { sent.push(mailOptions); return { messageId: 'test' }; }, sent };
}

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    originalHost = process.env.SMTP_HOST;
    originalFrom = process.env.SMTP_FROM;
});

after(async () => {
    server.close();
    await pool.end();
    if (originalHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = originalFrom;
});

beforeEach(async () => {
    await resetDb();
    delete process.env.SMTP_HOST;
    _clearTransportOverride();
    const user = await createTestUser('notify@example.com');
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

test('requires a session', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/test-email`, { method: 'POST' });
    assert.equal(res.status, 401);
});

test('returns 503 EMAIL_NOT_CONFIGURED when SMTP is unset', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'EMAIL_NOT_CONFIGURED');
});

test('sends the test email to the logged-in user\'s own address when configured', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    const transport = createRecordingTransport();
    _setTransportOverride(transport);

    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { ok: true });
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].to, 'notify@example.com');
});

test('returns 502 EMAIL_SEND_FAILED when the transport throws', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    _setTransportOverride({ sendMail: async () => { throw new Error('boom'); } });

    const res = await fetch(`${baseUrl}/api/notifications/test-email`, {
        method: 'POST',
        headers: csrfHeaders()
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, 'EMAIL_SEND_FAILED');
});

test('rate-limits repeated requests from the same client', async () => {
    const isolatedApp = createApp();
    const isolatedServer = isolatedApp.listen(0);
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedServer.address().port}`;
    try {
        const user = await createTestUser('ratelimit@example.com');
        const loginRes = await loginTestUser(isolatedBaseUrl, user.email, user.password);
        const isolatedCookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
        const csrfToken = isolatedCookies.match(/csrf=([^;]+)/)[1];
        const headers = { Cookie: isolatedCookies, 'X-CSRF-Token': csrfToken };

        for (let i = 0; i < 5; i++) {
            await fetch(`${isolatedBaseUrl}/api/notifications/test-email`, { method: 'POST', headers });
        }
        const res = await fetch(`${isolatedBaseUrl}/api/notifications/test-email`, { method: 'POST', headers });
        assert.equal(res.status, 429);
    } finally {
        isolatedServer.close();
    }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/notifications.test.js`
Expected: FAIL — 404s from the unmounted route (`Cannot find module` if `notifications.js` doesn't exist yet is also acceptable — create the file first per Step 3, then re-run)

- [ ] **Step 3: Write the route implementation**

Create `server/src/routes/notifications.js`:

```js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { sendTemplatedEmail } from '../email/send.js';
import { isEmailConfigured } from '../email/transport.js';

export default function createNotificationsRouter() {
    const router = express.Router();

    const testEmailLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
    });

    router.post('/test-email', testEmailLimiter, async (req, res, next) => {
        if (!isEmailConfigured()) {
            return res.status(503).json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'SMTP is not configured on this server' } });
        }

        let email;
        try {
            const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.userId]);
            if (rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
            }
            email = rows[0].email;
        } catch (err) {
            return next(err);
        }

        try {
            await sendTemplatedEmail(email, 'testEmail', { to: email });
            res.json({ ok: true });
        } catch (err) {
            console.error('[notifications] test-email send failed:', err);
            res.status(502).json({ error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send test email' } });
        }
    });

    return router;
}
```

- [ ] **Step 4: Mount the router in `app.js`**

In `server/src/app.js`, add the import alongside the other route imports (after `planSettingsRouter`):

```js
import planSettingsRouter from './routes/planSettings.js';
import createNotificationsRouter from './routes/notifications.js';
```

And mount it inside the existing `api` router block (after `api.use('/plan-settings', planSettingsRouter);`, still before `app.use('/api', api);`):

```js
    api.use('/plan-settings', planSettingsRouter);
    api.use('/notifications', createNotificationsRouter());
    app.use('/api', api);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && node --test test/notifications.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full server suite to confirm nothing else broke**

Run: `cd server && npm test`
Expected: all existing + new tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/notifications.js server/src/app.js server/test/notifications.test.js
git commit -m "feat(server): add POST /api/notifications/test-email"
```

---

## Task 5: Welcome email on account creation

**Files:**
- Modify: `server/scripts/create-user.js`
- Modify: `server/src/routes/auth.js`
- Modify: `server/test/auth.test.js` (extend)

**Interfaces:**
- Consumes: `sendTemplatedEmail` (Task 3).
- Produces: no new exports — behavior change only (best-effort welcome email fired after both user-creation paths).

- [ ] **Step 1: Write the failing test**

In `server/test/auth.test.js`, add the import at the top alongside the existing ones:

```js
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
```

Add these two tests (anywhere after the existing `register` tests — check the file for its existing `/register` test names first so these don't collide):

```js
test('register sends a welcome email when SMTP is configured', async () => {
    const originalHost = process.env.SMTP_HOST;
    const originalFrom = process.env.SMTP_FROM;
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'noreply@myfinances.test';
    const sent = [];
    _setTransportOverride({ sendMail: async (mail) => { sent.push(mail); return { messageId: 'test' }; } });

    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'newuser@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'newuser@example.com');
    assert.equal(sent[0].subject, 'Welcome to MyFinances');

    if (originalHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = originalFrom;
    _clearTransportOverride();
});

test('register still succeeds when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST;
    _clearTransportOverride();
    const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'anotheruser@example.com', password: 'correct horse battery staple' })
    });
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test test/auth.test.js`
Expected: FAIL on `register sends a welcome email...` — no email sent because `/register` doesn't call `sendTemplatedEmail` yet

- [ ] **Step 3: Wire the welcome email into `/register`**

In `server/src/routes/auth.js`, add the import at the top:

```js
import { sendTemplatedEmail } from '../email/send.js';
```

In the `POST /register` handler, after the cookies are set and just before `res.json({ ok: true })`, add a best-effort send:

```js
            res.cookie('session', session.id, { ...SESSION_COOKIE_OPTS, expires: session.expiresAt });
            res.cookie('csrf', csrfToken, { ...CSRF_COOKIE_OPTS, expires: session.expiresAt });

            try {
                await sendTemplatedEmail(email, 'welcomeEmail', { email });
            } catch (err) {
                console.error('[auth] welcome email failed:', err);
            }

            res.json({ ok: true });
```

- [ ] **Step 4: Wire the welcome email into `create-user.js`**

In `server/scripts/create-user.js`, add the import at the top:

```js
import { sendTemplatedEmail } from '../src/email/send.js';
```

After the `INSERT INTO users` line and before the final `console.log`, add:

```js
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);

    try {
        await sendTemplatedEmail(email, 'welcomeEmail', { email });
    } catch (err) {
        console.error('Welcome email failed (account was still created):', err.message);
    }

    console.log(`User ${email} created.`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && node --test test/auth.test.js`
Expected: PASS (all auth tests including the two new ones)

There's no existing automated-test harness for `create-user.js` itself (it's an interactive CLI that calls `main()` unconditionally at import time, making it impractical to `import` from a test). The existing `test-postgres` CI job already runs `create-user.js` for real as its "Seed test user" step (Task 9 adds Mailpit there), which is this change's real integration coverage — verify manually for now: `cd server && DATABASE_URL=... SMTP_HOST=smtp.example.com SMTP_FROM=test@test.com node scripts/create-user.js` against a scratch database and confirm it doesn't crash (the send will fail against a fake host, but must be caught and not affect the "User ... created." output or `process.exitCode`).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/auth.js server/scripts/create-user.js server/test/auth.test.js
git commit -m "feat(server): send a best-effort welcome email on account creation"
```

---

## Task 6: Docker secret plumbing (compose, entrypoint, CI)

**Files:**
- Modify: `server/docker-entrypoint.sh`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces (env var contract, consumed by `server/src/email/transport.js` from Task 1): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `SMTP_SECURE`, and `SMTP_PASSWORD` (exported by the entrypoint from the Docker secret).

No `node:test`/pytest coverage applies to shell/YAML config — this task's "test" is a syntax/config validation step in place of Steps 1-2/4-5 of the usual TDD shape.

- [ ] **Step 1: Extend `docker-entrypoint.sh`**

In `server/docker-entrypoint.sh`, after the existing Postgres secret block and before `exec "$@"`, add:

```sh
# SMTP is optional -- an empty or missing secret file just means email
# notifications stay disabled (server/src/email/transport.js's
# isEmailConfigured() checks SMTP_HOST, not this password).
SMTP_SECRET_FILE="/run/secrets/smtp_password"
if [ -s "$SMTP_SECRET_FILE" ]; then
    export SMTP_PASSWORD=$(cat "$SMTP_SECRET_FILE")
fi
```

(`-s`, not `-f` — treats an existing-but-empty placeholder file, which `setup.sh`/`setup.ps1` always create even when the operator declines SMTP setup, the same as "not configured".)

- [ ] **Step 2: Verify the entrypoint script's syntax**

Run: `sh -n server/docker-entrypoint.sh`
Expected: no output (syntax OK)

- [ ] **Step 3: Update `docker-compose.yml`**

Add `SMTP_*` env vars and the `smtp_password` secret to the `server` service:

```yaml
  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    image: myfinances-server:latest
    container_name: myfinances-server
    restart: unless-stopped
    environment:
      SESSION_TTL_DAYS: "7"
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_FROM: ${SMTP_FROM:-}
      SMTP_SECURE: ${SMTP_SECURE:-false}
    secrets:
      - postgres_password
      - smtp_password
```

(Only the `environment:` and `secrets:` blocks change — everything else in the `server` service is unchanged.) And add the new secret to the top-level `secrets:` block:

```yaml
secrets:
  postgres_password:
    file: ${POSTGRES_SECRET_FILE:-./secrets/postgres_password.txt}
  smtp_password:
    file: ${SMTP_SECRET_FILE:-./secrets/smtp_password.txt}
```

Docker Compose requires every file a service's `secrets:` list references to exist at `docker compose up` time — Task 7's `setup.sh`/`setup.ps1` changes always create `secrets/smtp_password.txt` (empty when SMTP is declined), and Step 4 below does the same for CI, so this doesn't break anyone already following the documented setup path. It does mean anyone bypassing `setup.sh`/`setup.ps1` (manual/Portainer deploys) must now also create an (optionally empty) `secrets/smtp_password.txt` — call this out in Task 10's `DEPLOYMENT.md` update.

- [ ] **Step 4: Update the CI job that runs `docker compose up` against the real stack**

In `.github/workflows/ci.yml`, find the `test-postgres` job's `Create postgres secret` step and extend it to also create the (empty) SMTP secret placeholder:

```yaml
      - name: Create Docker secrets
        run: |
          mkdir -p secrets
          echo "ci-test-password" > secrets/postgres_password.txt
          touch secrets/smtp_password.txt
```

(Renamed from `Create postgres secret` since it now creates two.)

- [ ] **Step 5: Document the new env vars in `.env.example`**

Append to `.env.example`:

```
# SMTP email sending (optional). Leave SMTP_HOST unset to disable email
# notifications entirely -- nothing else in this list matters until it's
# set. The SMTP account's password is NOT listed here -- see
# secrets/smtp_password.txt (a Docker secret, same pattern as
# secrets/postgres_password.txt). setup.sh/setup.ps1 configure all of
# this interactively; see server/README.md's "Email notifications"
# section for the manual/Portainer path.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_FROM=
SMTP_SECURE=false
```

- [ ] **Step 6: Validate the compose file parses correctly**

Run: `docker compose config --quiet` (from the repo root; requires `secrets/postgres_password.txt` and `secrets/smtp_password.txt` to exist locally first — create empty placeholders if you don't already have real ones, matching what Step 4's CI change does)
Expected: no output, exit code 0

- [ ] **Step 7: Commit**

```bash
git add server/docker-entrypoint.sh docker-compose.yml .env.example .github/workflows/ci.yml
git commit -m "feat(server): add optional SMTP secret/env plumbing to compose, entrypoint, and CI"
```

---

## Task 7: `setup.sh` / `setup.ps1` SMTP prompt

**Files:**
- Modify: `setup.sh`
- Modify: `setup.ps1`

**Interfaces:** none (shell scripts; no new exports).

- [ ] **Step 1: Add the SMTP step to `setup.sh`**

In `setup.sh`, insert a new step 2 between the existing "1. Generate postgres password" block and "2. Start the stack" block (renumber the two steps that follow it, "Start the stack" becomes step 3, "Run migrations" becomes step 4, "Create first user" becomes step 5):

```bash
# ── 2. Configure SMTP (optional) ────────────────────────────────────────────
if [ -f secrets/smtp_password.txt ]; then
    echo "→ secrets/smtp_password.txt already exists — skipping SMTP setup"
else
    echo ""
    read -rp "Configure SMTP for email notifications? [y/N] " configure_smtp
    mkdir -p secrets
    if [[ "$configure_smtp" =~ ^[Yy]$ ]]; then
        read -rp "  SMTP host: " smtp_host
        read -rp "  SMTP port [587]: " smtp_port
        smtp_port=${smtp_port:-587}
        read -rp "  SMTP username (blank if none): " smtp_user
        read -rp "  From address: " smtp_from
        read -rsp "  SMTP password: " smtp_password
        echo ""
        printf '%s' "$smtp_password" > secrets/smtp_password.txt
        {
            echo "SMTP_HOST=$smtp_host"
            echo "SMTP_PORT=$smtp_port"
            echo "SMTP_USER=$smtp_user"
            echo "SMTP_FROM=$smtp_from"
            echo "SMTP_SECURE=false"
        } > .env
        echo "→ Generated secrets/smtp_password.txt and .env"
    else
        touch secrets/smtp_password.txt
        echo "→ Skipping SMTP setup — email notifications will stay disabled"
    fi
fi

echo ""

# ── 3. Start the stack ────────────────────────────────────────────────────────
```

(The renumbered "3. Start the stack" header line replaces the old "2. Start the stack" header — the block's body/commands underneath are unchanged, only the leading comment and the two step numbers after it shift by one.)

- [ ] **Step 2: Verify `setup.sh`'s syntax**

Run: `bash -n setup.sh`
Expected: no output (syntax OK)

- [ ] **Step 3: Add the equivalent step to `setup.ps1`**

In `setup.ps1`, insert the equivalent block between the existing "1. Generate postgres password" block and "2. Start the stack" block (renumbering the same way):

```powershell
# -- 2. Configure SMTP (optional) -----------------------------------------------
if (Test-Path "secrets\smtp_password.txt") {
    Write-Host "-> secrets\smtp_password.txt already exists -- skipping SMTP setup"
} else {
    Write-Host ""
    $configureSmtp = Read-Host "Configure SMTP for email notifications? [y/N]"
    New-Item -ItemType Directory -Force "secrets" | Out-Null
    if ($configureSmtp -match '^[Yy]$') {
        $smtpHost = Read-Host "  SMTP host"
        $smtpPortInput = Read-Host "  SMTP port [587]"
        $smtpPort = if ($smtpPortInput) { $smtpPortInput } else { "587" }
        $smtpUser = Read-Host "  SMTP username (blank if none)"
        $smtpFrom = Read-Host "  From address"
        $smtpPasswordSecure = Read-Host "  SMTP password" -AsSecureString
        $smtpPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPasswordSecure)
        )
        [System.IO.File]::WriteAllText((Resolve-Path "secrets").Path + "\smtp_password.txt", $smtpPassword)
        @(
            "SMTP_HOST=$smtpHost"
            "SMTP_PORT=$smtpPort"
            "SMTP_USER=$smtpUser"
            "SMTP_FROM=$smtpFrom"
            "SMTP_SECURE=false"
        ) | Set-Content -Path ".env"
        Write-Host "-> Generated secrets\smtp_password.txt and .env"
    } else {
        New-Item -ItemType File "secrets\smtp_password.txt" | Out-Null
        Write-Host "-> Skipping SMTP setup -- email notifications will stay disabled"
    }
}

Write-Host ""

# -- 3. Start the stack --------------------------------------------------------
```

- [ ] **Step 4: Verify `setup.ps1` parses**

Run: `powershell -NoProfile -Command "[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw setup.ps1), [ref]$null) | Out-Null; Write-Host 'OK'"` (Windows) or skip if PowerShell isn't available in the current environment and rely on careful review instead.
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add setup.sh setup.ps1
git commit -m "feat: add optional interactive SMTP configuration to first-time setup"
```

---

## Task 8: Settings-modal "Send test email" button

**Files:**
- Modify: `index.html`
- Modify: `src/ui.js`
- Modify: `src/setupWizard.js`
- Modify: `styles-csp-classes.css`

**Interfaces:**
- Consumes: `getCsrfCookie` (`src/storage.js`, already imported elsewhere), `showLoginGate` (`src/loginGate.js`), the `POST /api/notifications/test-email` route (Task 4).
- Produces: `showEmailTestToast(status: 'success' | 'error' | 'info', message: string): void` — new named export of `src/ui.js`. New DOM ids: `#settingsEmailTestGroup`, `#settingsSendTestEmailBtn`, `#emailTestToast` (created dynamically, like `#pgErrorToast`).

No automated test in this task — the button is only meaningfully testable end-to-end against a running Postgres+SMTP stack, which Task 9 adds. This task ends with a manual smoke-test step instead.

- [ ] **Step 1: Add the button markup to `index.html`**

In `index.html`, immediately after the `settingsStoragePostgresNote` paragraph's closing `</div>` (the "Data Storage" `form-group`, right before the "Language" `form-group` — see the block around line 1150-1160), insert:

```html
            <div class="form-group modal-form-group hidden" id="settingsEmailTestGroup">
                <button type="button" id="settingsSendTestEmailBtn" class="btn btn-secondary">Send test email</button>
                <p class="modal-helper-text">Sends a test email to your account's address to verify the server's SMTP configuration.</p>
            </div>
```

- [ ] **Step 2: Add the toast styles to `styles-csp-classes.css`**

Immediately after the existing `.pg-error-toast` rule, add:

```css
.email-test-toast {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 9998;
    max-width: min(400px, 90vw);
    padding: 11px 16px;
    border-radius: 10px;
    color: #fff;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);
    font-size: 0.87rem;
    line-height: 1.4;
    animation: toast-slide-in 0.25s ease forwards;
}

.email-test-toast--success {
    background: #16a34a;
}

.email-test-toast--error {
    background: #dc2626;
}

.email-test-toast--info {
    background: #64748b;
}
```

- [ ] **Step 3: Add `showEmailTestToast` to `src/ui.js`**

Immediately after the existing `showPgErrorToast` function, add:

```js
let _emailTestToastTimer = null;

export function showEmailTestToast(status, message) {
    if (_emailTestToastTimer !== null) {
        clearTimeout(_emailTestToastTimer);
        document.getElementById('emailTestToast')?.remove();
    }
    const el = document.createElement('div');
    el.id = 'emailTestToast';
    el.className = `email-test-toast email-test-toast--${status}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    _emailTestToastTimer = setTimeout(() => {
        document.getElementById('emailTestToast')?.remove();
        _emailTestToastTimer = null;
    }, 5000);
}
```

- [ ] **Step 4: Wire the button in `src/setupWizard.js`**

Add these two imports at the top of `src/setupWizard.js`:

```js
import { getCsrfCookie } from './storage.js';
import { showLoginGate } from './loginGate.js';
import { showEmailTestToast } from './ui.js';
```

In `initSettingsModal(app)`, alongside the existing `storageSelect`/`postgresLockNote` lookups, add:

```js
    const emailTestGroup = document.getElementById('settingsEmailTestGroup');
    const sendTestEmailBtn = document.getElementById('settingsSendTestEmailBtn');
```

In `open()`, alongside the existing `isPostgres` branch that toggles `postgresLockNote`, also toggle `emailTestGroup`:

```js
        if (isPostgres) {
            storageSelect.value = 'postgres';
            storageSelect.classList.add('hidden');
            if (postgresLockNote) postgresLockNote.classList.remove('hidden');
            if (emailTestGroup) emailTestGroup.classList.remove('hidden');
        } else {
            storageSelect.value = getStorageBackendPreference();
            storageSelect.classList.remove('hidden');
            if (postgresLockNote) postgresLockNote.classList.add('hidden');
            if (emailTestGroup) emailTestGroup.classList.add('hidden');
        }
```

After the existing `settingsBtn.onclick = open;` / `closeBtn.onclick = close;` / `doneBtn.onclick = save;` lines, add the click handler:

```js
    if (sendTestEmailBtn) {
        sendTestEmailBtn.onclick = async () => {
            sendTestEmailBtn.disabled = true;
            try {
                const res = await fetch('/api/notifications/test-email', {
                    method: 'POST',
                    headers: { 'X-CSRF-Token': getCsrfCookie() }
                });
                if (res.status === 401) {
                    await showLoginGate(app);
                    return;
                }
                if (res.status === 200) {
                    showEmailTestToast('success', 'Test email sent — check your inbox.');
                } else if (res.status === 503) {
                    showEmailTestToast('info', "SMTP isn't configured on this server.");
                } else {
                    showEmailTestToast('error', 'Failed to send test email.');
                }
            } catch {
                showEmailTestToast('error', 'Failed to send test email.');
            } finally {
                sendTestEmailBtn.disabled = false;
            }
        };
    }
```

- [ ] **Step 5: Manual smoke test**

Run: `python -m http.server 32900` from the repo root, open `http://localhost:32900`, open Settings — confirm the new button is **not** visible (default Local Storage backend). This confirms the `hidden` class and the `isPostgres` toggle wiring didn't break anything for the non-Postgres path (the positive Postgres-backend path is covered end-to-end by Task 9's Playwright test, which needs the full Docker stack).

- [ ] **Step 6: Commit**

```bash
git add index.html src/ui.js src/setupWizard.js styles-csp-classes.css
git commit -m "feat: add Send test email button to the Settings modal"
```

---

## Task 9: Mailpit test sink + Playwright coverage

**Files:**
- Create: `docker-compose.mailpit.yml`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/postgres/test_postgres_notifications.py`

**Interfaces:**
- Consumes: `#settingsBtn`, `#settingsModal` (existing), `#settingsEmailTestGroup`, `#settingsSendTestEmailBtn`, `#emailTestToast` (Task 8); `POST /api/notifications/test-email` (Task 4); the `pg_page`/`base_url`/`credentials` fixtures from `tests/postgres/conftest.py`.

- [ ] **Step 1: Add the Mailpit compose overlay**

Create `docker-compose.mailpit.yml` at the repo root — used only in CI (and optionally by a developer testing email locally), never merged into the production `docker-compose.yml`, so a normal deployment never runs an SMTP sink container:

```yaml
services:
  mailpit:
    image: axllent/mailpit:latest
    container_name: myfinances-mailpit
    restart: unless-stopped
    ports:
      - "8025:8025"

  server:
    environment:
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
      SMTP_USER: ""
      SMTP_FROM: "noreply@myfinances.test"
      SMTP_SECURE: "false"
    depends_on:
      mailpit:
        condition: service_started
```

(`depends_on` and `environment` are both mapping-typed in Compose, so this overlay merges additively into the base file's `server` service — it doesn't replace the base's `depends_on: { postgres: ... }`, it adds `mailpit` alongside it.)

- [ ] **Step 2: Wire the overlay into the CI job**

In `.github/workflows/ci.yml`, add a job-level `env` to `test-postgres` so every `docker compose` command in that job picks up both files automatically:

```yaml
  test-postgres:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      COMPOSE_FILE: docker-compose.yml:docker-compose.mailpit.yml
    steps:
```

- [ ] **Step 3: Write the Playwright test**

Create `tests/postgres/test_postgres_notifications.py`:

```python
import pytest
from playwright.async_api import async_playwright, expect

pytestmark = pytest.mark.asyncio

MAILPIT_API = 'http://localhost:8025/api/v1'


async def _clear_mailpit(page):
    await page.request.delete(f'{MAILPIT_API}/messages')


async def _latest_mailpit_message(page):
    res = await page.request.get(f'{MAILPIT_API}/messages')
    data = await res.json()
    messages = data.get('messages', [])
    return messages[0] if messages else None


async def _login(page, base_url, credentials):
    await page.goto(base_url)
    gate = page.locator('#loginGate')
    await gate.wait_for(state='visible', timeout=8000)
    await page.fill('#loginGateEmail', credentials['email'])
    await page.fill('#loginGatePassword', credentials['password'])
    async with page.expect_response(lambda r: '/auth/login' in r.url, timeout=10000):
        await page.click('.login-gate-submit')
    await gate.wait_for(state='hidden', timeout=12000)
    await page.wait_for_selector('#topNav', state='visible', timeout=8000)


async def test_send_test_email_button_hidden_for_non_postgres_backend(base_url):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(base_url)
        await page.wait_for_selector('#topNav', state='visible', timeout=8000)
        await page.click('#settingsBtn')
        await page.wait_for_selector('#settingsModal', state='visible', timeout=5000)
        assert not await page.locator('#settingsEmailTestGroup').is_visible()
        await browser.close()


async def test_send_test_email_delivers_to_mailpit(pg_page, base_url, credentials):
    await _clear_mailpit(pg_page)
    await _login(pg_page, base_url, credentials)

    await pg_page.click('#settingsBtn')
    await pg_page.wait_for_selector('#settingsModal', state='visible', timeout=5000)

    group = pg_page.locator('#settingsEmailTestGroup')
    await expect(group).to_be_visible()

    async with pg_page.expect_response(
        lambda r: '/api/notifications/test-email' in r.url, timeout=10000
    ) as resp_info:
        await pg_page.click('#settingsSendTestEmailBtn')
    resp = await resp_info.value
    assert resp.status == 200

    toast = pg_page.locator('#emailTestToast')
    await expect(toast).to_be_visible(timeout=5000)
    toast_text = (await toast.text_content() or '').lower()
    assert 'sent' in toast_text

    message = await _latest_mailpit_message(pg_page)
    assert message is not None, 'Mailpit received no message'
    to_addresses = [t.get('Address', '') for t in message.get('To', [])]
    assert credentials['email'] in to_addresses
```

- [ ] **Step 4: Run the new tests against the live stack**

Run (from the repo root, with Docker running):
```bash
mkdir -p secrets && echo "ci-test-password" > secrets/postgres_password.txt && touch secrets/smtp_password.txt
COMPOSE_FILE=docker-compose.yml:docker-compose.mailpit.yml docker compose up -d --build
docker compose run --rm server npm run migrate up
printf "testuser@example.com\nci-test-password\n" | docker compose run --rm -T server node scripts/create-user.js
POSTGRES_TEST_BASE_URL=http://localhost:32900 POSTGRES_TEST_EMAIL=testuser@example.com POSTGRES_TEST_PASSWORD=ci-test-password pytest tests/postgres/test_postgres_notifications.py -v
docker compose down -v
```
Expected: both new tests PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.mailpit.yml .github/workflows/ci.yml tests/postgres/test_postgres_notifications.py
git commit -m "test: add Mailpit-backed end-to-end coverage for the test-email flow"
```

---

## Task 10: Documentation

**Files:**
- Modify: `server/README.md`
- Modify: `DEPLOYMENT.md`
- Modify: `CLAUDE.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a section to `server/README.md`**

At the end of `server/README.md` (after the existing "Production" section's content, which currently ends with the backup/restore paragraph), append:

```markdown

## Email notifications (optional)

The server can send email over SMTP — currently just a "send test email"
action from the app's Settings modal, plus an automatic welcome email when
an account is created. It's off by default; automated bill/balance
notifications are a future feature built on top of this foundation. See
`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`
for the full design.

### Configuring SMTP

Run `setup.sh`/`setup.ps1` and answer "y" when asked to configure SMTP, or
configure manually:

- Set `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_FROM`,
  and `SMTP_SECURE` (`true`/`false`) as environment variables on the
  `server` service — a root `.env` file works with the provided
  `docker-compose.yml`.
- Place the SMTP account's password in `secrets/smtp_password.txt`, a
  Docker secret using the same pattern as
  `secrets/postgres_password.txt` — `docker-entrypoint.sh` reads it into
  `SMTP_PASSWORD` at container startup.

Leaving `SMTP_HOST` unset disables the feature entirely — nothing fails
to start, and the test-email endpoint just returns
`503 EMAIL_NOT_CONFIGURED`. `secrets/smtp_password.txt` must still exist
(even empty) because Docker Compose requires every file a service's
`secrets:` list references to be present — `setup.sh`/`setup.ps1` create
it either way.

### Verifying it works

Log in, open Settings, and click "Send test email" — it emails the
logged-in account's own address (never an arbitrary address the client
supplies, so the endpoint can't be used as an open relay).
```

- [ ] **Step 2: Add a subsection to `DEPLOYMENT.md`**

In `DEPLOYMENT.md`, under the "PostgreSQL Backend Deployment (Optional — Multi-Device Sync)" section, insert a new `### Email Notifications (Optional)` subsection right after the existing `### Backup and Restore` subsection and before `### Manual / Custom Deployment`:

```markdown
### Email Notifications (Optional)

The self-hosted server can send SMTP email — currently a "send test
email" action in Settings plus an automatic welcome email on account
creation; see `server/README.md`'s "Email notifications" section for
full configuration steps. `setup.sh`/`setup.ps1` prompt for it during
first-time setup; declining leaves it disabled with no further action
needed. To configure it later, delete `secrets/smtp_password.txt` and
re-run `setup.sh`/`setup.ps1` so the prompt reappears, or hand-edit
`.env` and `secrets/smtp_password.txt` directly and run
`docker compose up -d` again to pick up the change.
```

- [ ] **Step 3: Extend `CLAUDE.md`'s Cross-cutting features list**

In `CLAUDE.md`, immediately after the existing "**Backend service (optional, Phase 2c)**" bullet in the "Cross-cutting features" list, add a new bullet:

```markdown
- **Email notifications (optional, server-only)** — `server/src/email/` (`transport.js`, `send.js`, `templates/`) sends SMTP email via `nodemailer`, configured the same way as the Postgres secret (`SMTP_HOST`/`PORT`/`USER`/`FROM`/`SECURE` env vars plus a `secrets/smtp_password.txt` Docker secret — both optional; an unset `SMTP_HOST` disables the feature entirely, with no startup failure). Currently wired to exactly one trigger, the Settings modal's "Send test email" button (`POST /api/notifications/test-email`, `src/setupWizard.js`), plus a best-effort welcome email fired from both places a user account gets created (`server/scripts/create-user.js`, `POST /auth/register`). No scheduler exists yet — automated notifications (bill-due reminders, low-balance alerts, etc.) are a future feature that will call the existing `sendTemplatedEmail()` from new trigger code rather than build a new pipeline. See `docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add server/README.md DEPLOYMENT.md CLAUDE.md
git commit -m "docs: document SMTP email notifications setup and architecture"
```

---

## Task 11: Version bump

**Files:**
- Modify: `src/utils.js`
- Modify: `sw.js`
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test run (baseline)**

Run: `pytest tests/features/test_versioning.py -v`
Expected: currently PASS at `4.41.0` (no drift yet) — this step just confirms the starting state before you introduce a bump, so a later failure is attributable to your own edit, not a pre-existing issue.

- [ ] **Step 2: Bump `APP_VERSION`**

In `src/utils.js`:

```js
export const APP_VERSION = '4.42.0';
```

- [ ] **Step 3: Bump the service worker cache name**

In `sw.js`:

```js
const CACHE_NAME = 'myfinances-v4.42.0';
```

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, insert a new heading immediately above the existing `## [4.41.0] — 2026-09-02` entry:

```markdown
## [4.42.0] — 2026-09-03

### Added
- **SMTP email infrastructure + template system** (`docs/superpowers/specs/2026-09-03-smtp-email-notifications-design.md`): a server-only foundation for future notifications. `server/src/email/` provides a `nodemailer`-based transport (configured via `SMTP_HOST`/`PORT`/`USER`/`FROM`/`SECURE` env vars plus a `secrets/smtp_password.txt` Docker secret, mirroring the existing Postgres-password pattern — entirely optional, silently disabled when unconfigured) and a plain-JS template system (`testEmail`, `welcomeEmail`, `alertEmail`). A new authenticated `POST /api/notifications/test-email` endpoint (Settings modal's new "Send test email" button, visible only on the PostgreSQL backend) sends a verification email to the logged-in user's own address — never a client-supplied one, avoiding an open-relay vector. `server/scripts/create-user.js` and `POST /auth/register` now send a best-effort welcome email on account creation. `setup.sh`/`setup.ps1` gained an optional interactive SMTP configuration step.

---
```

(The trailing `---` matches the separator the changelog already uses between version entries — copy the exact spacing from the existing `4.41.0` entry above it.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/features/test_versioning.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils.js sw.js CHANGELOG.md
git commit -m "chore: bump to v4.42.0 — SMTP email infrastructure"
```

---

## Task 12: Full verification pass

**Files:** none modified — verification only.

- [ ] **Step 1: Run the server test suite**

Run: `cd server && npm test`
Expected: all tests PASS (requires `docker compose -f server/docker-compose.test.yml up -d` and `DATABASE_URL` pointed at it first, per `server/README.md`'s "Tests" section)

- [ ] **Step 2: Run the frontend Playwright suite**

Run: `python -m http.server 32900` (separate terminal), then `pytest tests/ -v -m "not slow"`
Expected: all tests PASS, including `tests/features/test_versioning.py` and `tests/features/test_pwa.py` (which checks `APP_VERSION`/`CACHE_NAME` stay in sync)

- [ ] **Step 3: Run the full Postgres integration suite** (Task 9's step 4 already did this for the new file specifically; this repeats it for the whole `tests/postgres/` directory to catch any regression in the existing Postgres tests)

Run the same Docker Compose sequence as Task 9 Step 4, but with `pytest tests/postgres -v` instead of just the new file.
Expected: all tests PASS

- [ ] **Step 4: Run Jest/Stryker (unaffected by this change, but confirm no drift)**

Run: `npm install && npm run test:unit`
Expected: PASS (this plan doesn't touch `src/debtCalculator.js`, `src/utils.js`'s Stryker-covered ranges, or `src/sanitizers.js`'s covered ranges, so this should be a no-op confirmation)

No commit for this task — it's a verification gate before opening the PR.
