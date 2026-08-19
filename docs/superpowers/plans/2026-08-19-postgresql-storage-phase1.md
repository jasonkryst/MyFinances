# PostgreSQL Storage Phase 1 (Backend Service) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, self-hosted Node.js + Postgres backend service (`server/`) with relational tables and granular REST endpoints for every MyFinances record type, secured by argon2id + server-side sessions — with zero changes to the existing browser app.

**Architecture:** Express app (`server/src/app.js`) behind `requireSession`/`requireCsrf` middleware on `/api/*`. Two router factories (`crudRouter.js` for id-keyed resources, `keyedRouter.js` for date/string-keyed resources) generate the ten standard CRUD resources and three keyed resources from small per-resource config objects, reusing the project's existing `src/sanitizers.js`/`src/utils.js` (plain, DOM-free ESM) for validation both client- and server-side. `node-pg-migrate` manages schema; `node --test` + real `fetch` calls against an ephemeral-port `http.Server` drive integration tests against a real Postgres instance (no mocking the database).

**Tech Stack:** Node.js ≥20 (built-in `--test` runner, built-in `fetch`), Express 4, `pg`, `argon2`, `express-rate-limit`, `cookie-parser`, `node-pg-migrate`, PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-08-19-postgresql-storage-phase1-design.md`

## Global Constraints

- No changes to any file under `src/`, `index.html`, `tests/` (Playwright), or the root `package.json` (Jest/Stryker toolchain) — this plan is additive-only, confined to a new `server/` directory plus `docker-compose.yml`/`nginx.conf`.
- Every write endpoint validates through the matching `sanitize*` function from `src/sanitizers.js` (imported by relative path, not duplicated) before touching Postgres.
- Money columns are `numeric`, never `float`/`double precision`. Calendar dates are `date`; write timestamps are `timestamptz`.
- Every table (except `users`/`sessions`) has `user_id bigint references users(id) on delete cascade`; every query is scoped `WHERE user_id = req.userId` from session middleware — never a client-supplied user ID.
- No open self-registration endpoint. The single user is created via `server/scripts/create-user.js`, run manually.
- Sessions are server-side (Postgres `sessions` table + opaque token cookie), not JWT — required for instant logout revocation per the spec.
- IDs are server-generated `bigserial`; the API always returns the created row (including its ID) so callers never need to generate their own.
- All new secrets/env files (`server/.env`, `secrets/postgres_password.txt`) must be gitignored — never commit real credentials.

---

### Task 1: Project scaffold — Express app, health check, DB pool

**Files:**
- Create: `server/package.json`
- Create: `server/.env.example`
- Create: `server/.gitignore`
- Create: `server/src/db.js`
- Create: `server/src/app.js`
- Create: `server/src/index.js`
- Create: `server/test/app.test.js`

**Interfaces:**
- Produces: `createApp()` from `server/src/app.js` — returns an Express app with no `.listen()` call, `GET /health` route, a 404 handler, and a 500 JSON error handler (`{ error: { code: 'INTERNAL_ERROR', message } }`). Later tasks add `app.use('/auth', ...)` and mount `/api` sub-routes inside this file.
- Produces: `query(text, params)` and `pool` from `server/src/db.js` — thin wrapper over a `pg.Pool` built from `process.env.DATABASE_URL` (throws at import time if unset).

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "myfinances-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/index.js",
    "migrate": "node-pg-migrate",
    "create-user": "node scripts/create-user.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "argon2": "^0.41.1",
    "cookie-parser": "^1.4.7",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "node-pg-migrate": "^7.6.1",
    "pg": "^8.13.1"
  }
}
```

- [ ] **Step 2: Create `server/.env.example` and `server/.gitignore`**

`server/.env.example`:
```
DATABASE_URL=postgres://myfinances:changeme@localhost:5432/myfinances
PORT=4000
SESSION_TTL_DAYS=7
```

`server/.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 3: Create `server/src/db.js`**

```js
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function query(text, params) {
    return pool.query(text, params);
}
```

- [ ] **Step 4: Create `server/src/app.js`**

```js
import express from 'express';
import cookieParser from 'cookie-parser';

export function createApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    app.use((req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        console.error(err);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    });

    return app;
}
```

- [ ] **Step 5: Create `server/src/index.js`**

```js
import { createApp } from './app.js';

const app = createApp();
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`myfinances-server listening on ${port}`));
```

- [ ] **Step 6: Write the failing test — `server/test/app.test.js`**

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server, baseUrl;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('GET /health returns 200 ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
});

test('unknown route returns 404 JSON', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
});
```

Note: `db.js` isn't imported by `app.js` yet, so `DATABASE_URL` isn't required for this test.

- [ ] **Step 7: Install dependencies and run the test**

Run:
```bash
cd server && npm install && npm test
```
Expected: both tests PASS (there is no implementation gap — this task's "test" step doubles as verification since `app.js` is written before the test in the file list above; if you are following strict TDD, write `app.test.js` first, run it, see it fail on the missing `../src/app.js` module, then add Steps 1-5).

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/.env.example server/.gitignore server/src/db.js server/src/app.js server/src/index.js server/test/app.test.js server/package-lock.json
git commit -m "server: scaffold Express app with health check and DB pool"
```

---

### Task 2: Migration tooling + `users`/`sessions` schema

**Files:**
- Create: `server/migrations/1755600000000_create-users-and-sessions.js`
- Create: `server/docker-compose.test.yml`
- Create: `server/test/helpers/testDb.js`
- Test: `server/test/migrations.test.js`

**Interfaces:**
- Consumes: `pool`/`query` from `server/src/db.js` (Task 1).
- Produces: `resetDb()`, `createTestUser(email?, password?)`, `loginTestUser(baseUrl, email, password)` from `server/test/helpers/testDb.js` — used by every later test file. `createTestUser` returns `{ id, email, password }`; `loginTestUser` performs `POST /auth/login` and returns the raw `Response` (callers read `res.headers.getSetCookie()`).

- [ ] **Step 1: Start a local test Postgres — `server/docker-compose.test.yml`**

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: myfinances_test
      POSTGRES_USER: myfinances_test
      POSTGRES_PASSWORD: myfinances_test
    ports:
      - "5433:5432"
```

Run:
```bash
cd server && docker compose -f docker-compose.test.yml up -d
```
Expected: container starts; `docker compose -f docker-compose.test.yml ps` shows it healthy/running within a few seconds.

- [ ] **Step 2: Write the migration — `server/migrations/1755600000000_create-users-and-sessions.js`**

```js
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE users (
            id bigserial PRIMARY KEY,
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE sessions (
            id text PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE sessions; DROP TABLE users;`);
}
```

- [ ] **Step 3: Run the migration against the test database**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: output confirms `1755600000000_create-users-and-sessions` applied; `psql` or a one-off `node -e` query confirms `users` and `sessions` tables exist with the columns above.

- [ ] **Step 4: Create `server/test/helpers/testDb.js`**

```js
import { pool } from '../../src/db.js';
import argon2 from 'argon2';

export async function resetDb() {
    await pool.query('TRUNCATE sessions, users RESTART IDENTITY CASCADE');
}

export async function createTestUser(email = 'test@example.com', password = 'correct horse battery staple') {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, hash]
    );
    return { id: rows[0].id, email, password };
}

export async function loginTestUser(baseUrl, email, password) {
    return fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
}
```

`loginTestUser` will 404 until Task 5 adds `/auth/login` — that's expected here; this task only proves `resetDb`/`createTestUser` work against the real schema.

- [ ] **Step 5: Write the failing test — `server/test/migrations.test.js`**

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';

after(() => pool.end());

test('users table accepts a hashed-password row', async () => {
    await resetDb();
    const user = await createTestUser();
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [user.id]);
    assert.equal(rows[0].email, 'test@example.com');
});

test('sessions cascade-delete when their user is deleted', async () => {
    await resetDb();
    const user = await createTestUser();
    await pool.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('tok', $1, now() + interval '1 day')",
        [user.id]
    );
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { rows } = await pool.query('SELECT * FROM sessions');
    assert.equal(rows.length, 0);
});
```

- [ ] **Step 6: Run the test**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/migrations.test.js
```
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/migrations server/docker-compose.test.yml server/test/helpers/testDb.js server/test/migrations.test.js
git commit -m "server: add users/sessions schema and migration tooling"
```

---

### Task 3: Argon2 hashing + bootstrap user-creation script

**Files:**
- Create: `server/src/auth/argon2.js`
- Create: `server/scripts/create-user.js`
- Test: `server/test/argon2.test.js`

**Interfaces:**
- Produces: `hashPassword(password)`, `verifyPassword(hash, password)` from `server/src/auth/argon2.js` — used by Task 5's login route and this task's script.

- [ ] **Step 1: Write the failing test — `server/test/argon2.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/argon2.js';

test('hashPassword produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
    assert.equal(await verifyPassword(hash, 'wrong password'), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && node --test test/argon2.test.js`
Expected: FAIL — `Cannot find module '../src/auth/argon2.js'`

- [ ] **Step 3: Create `server/src/auth/argon2.js`**

```js
import argon2 from 'argon2';

export function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash, password) {
    return argon2.verify(hash, password);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/argon2.test.js`
Expected: PASS

- [ ] **Step 5: Create the bootstrap script — `server/scripts/create-user.js`**

```js
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pool } from '../src/db.js';
import { hashPassword } from '../src/auth/argon2.js';

async function main() {
    const { rows } = await pool.query('SELECT count(*)::int AS count FROM users');
    if (rows[0].count > 0) {
        console.error('A user already exists. This is a single-user deployment; refusing to create another.');
        process.exitCode = 1;
        return;
    }

    const rl = readline.createInterface({ input: stdin, output: stdout });
    const email = await rl.question('Email: ');
    const password = await rl.question('Password (min 12 chars): ');
    rl.close();

    if (!email.includes('@')) {
        console.error('Invalid email.');
        process.exitCode = 1;
        return;
    }
    if (password.length < 12) {
        console.error('Password must be at least 12 characters.');
        process.exitCode = 1;
        return;
    }

    const hash = await hashPassword(password);
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, hash]);
    console.log(`User ${email} created.`);
}

main().finally(() => pool.end());
```

- [ ] **Step 6: Manually verify the script against the test database**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node -e "require('./src/db.js')" 2>/dev/null; node --input-type=module -e "
import { pool } from './src/db.js';
await pool.query('TRUNCATE users CASCADE');
await pool.end();
"
printf 'owner@example.com\ncorrect horse battery staple\n' | node scripts/create-user.js
```
Expected: prints `User owner@example.com created.`; running it a second time prints the "already exists" refusal and exits non-zero.

- [ ] **Step 7: Commit**

```bash
git add server/src/auth/argon2.js server/scripts/create-user.js server/test/argon2.test.js
git commit -m "server: add argon2id hashing and single-user bootstrap script"
```

---

### Task 4: Session store + auth/CSRF middleware

**Files:**
- Create: `server/src/auth/sessions.js`
- Create: `server/src/auth/middleware.js`
- Modify: `server/src/app.js` — mount a protected test route for verification, then remove it (see Step 5)
- Test: `server/test/middleware.test.js`

**Interfaces:**
- Consumes: `query`/`pool` (Task 1), `resetDb`/`createTestUser` (Task 2).
- Produces: `generateToken()`, `requireSession(req, res, next)`, `requireCsrf(req, res, next)` from `server/src/auth/middleware.js`. `requireSession` sets `req.userId`. Produces: `createSession(userId)` → `{ id, expiresAt }`, `destroySession(sessionId)` from `server/src/auth/sessions.js`. These are consumed by Task 5 (login/logout) and every resource router from Task 6 onward.

- [ ] **Step 1: Create `server/src/auth/middleware.js`**

```js
import crypto from 'node:crypto';
import { query } from '../db.js';

export function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

export async function requireSession(req, res, next) {
    const sessionId = req.cookies?.session;
    if (!sessionId) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    const { rows } = await query('SELECT user_id, expires_at FROM sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0 || new Date(rows[0].expires_at) <= new Date()) {
        if (rows.length > 0) await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        res.clearCookie('session');
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    req.userId = rows[0].user_id;
    next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookieToken = req.cookies?.csrf;
    const headerToken = req.get('X-CSRF-Token');
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: { code: 'CSRF_MISMATCH', message: 'Missing or invalid CSRF token' } });
    }
    next();
}
```

- [ ] **Step 2: Create `server/src/auth/sessions.js`**

```js
import { query } from '../db.js';
import { generateToken } from './middleware.js';

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

export async function createSession(userId) {
    const id = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expiresAt]);
    return { id, expiresAt };
}

export function destroySession(sessionId) {
    return query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
```

- [ ] **Step 3: Add a permanent session-check diagnostic route to `server/src/app.js`**

Modify `server/src/app.js`: add this import at the top —
```js
import { requireSession, requireCsrf } from './auth/middleware.js';
```
— and add these routes directly above the `app.use((req, res) => {` 404 handler:
```js
    app.get('/health/session-check', requireSession, (req, res) => res.json({ userId: req.userId }));
    app.post('/health/session-check', requireSession, requireCsrf, (req, res) => res.json({ ok: true }));
```
This is an internal diagnostic endpoint (not part of the public `/api` resource surface documented in the spec) that stays in the app permanently — it lets this task's tests exercise `requireSession`/`requireCsrf` directly, and Task 5's logout test reuses it to prove a session was actually invalidated.

- [ ] **Step 4: Write the failing test — `server/test/middleware.test.js`**

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser } from './helpers/testDb.js';
import { createSession } from '../src/auth/sessions.js';
import { generateToken } from '../src/auth/middleware.js';

let server, baseUrl;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(() => resetDb());

test('rejects requests with no session cookie', async () => {
    const res = await fetch(`${baseUrl}/health/session-check`);
    assert.equal(res.status, 401);
});

test('accepts a valid session cookie and attaches userId', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        headers: { Cookie: `session=${session.id}` }
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userId, user.id);
});

test('rejects an expired session', async () => {
    const user = await createTestUser();
    const expiredId = generateToken();
    await pool.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() - interval '1 minute')",
        [expiredId, user.id]
    );
    const res = await fetch(`${baseUrl}/health/session-check`, {
        headers: { Cookie: `session=${expiredId}` }
    });
    assert.equal(res.status, 401);
});

test('rejects a mutating request missing the CSRF header', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        method: 'POST',
        headers: { Cookie: `session=${session.id}; csrf=abc` }
    });
    assert.equal(res.status, 403);
});

test('accepts a mutating request with matching CSRF cookie and header', async () => {
    const user = await createTestUser();
    const session = await createSession(user.id);
    const res = await fetch(`${baseUrl}/health/session-check`, {
        method: 'POST',
        headers: { Cookie: `session=${session.id}; csrf=abc`, 'X-CSRF-Token': 'abc' }
    });
    assert.equal(res.status, 200);
});
```

- [ ] **Step 5: Run the tests**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/middleware.test.js
```
Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/auth/sessions.js server/src/auth/middleware.js server/src/app.js server/test/middleware.test.js
git commit -m "server: add session store and auth/CSRF middleware"
```

---

### Task 5: Login/logout routes with rate limiting

**Files:**
- Create: `server/src/routes/auth.js`
- Modify: `server/src/app.js` — mount `authRouter` at `/auth`
- Modify: `server/test/helpers/testDb.js` — no change needed (`loginTestUser` from Task 2 already targets `/auth/login`)
- Test: `server/test/auth.test.js`

**Interfaces:**
- Consumes: `verifyPassword` (Task 3), `createSession`/`destroySession` (Task 4), `generateToken` (Task 4).
- Produces: `authRouter` (default export) from `server/src/routes/auth.js`, mounted at `/auth` — `POST /auth/login`, `POST /auth/logout`. Sets `session` (httpOnly) and `csrf` (readable) cookies on login.

- [ ] **Step 1: Create `server/src/routes/auth.js`**

```js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { verifyPassword } from '../auth/argon2.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { generateToken } from '../auth/middleware.js';

const authRouter = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } }
});

const SESSION_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
const CSRF_COOKIE_OPTS = { httpOnly: false, secure: true, sameSite: 'strict', path: '/' };

authRouter.post('/login', loginLimiter, async (req, res, next) => {
    try {
        const { email, password } = req.body || {};
        const reject = () => res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
        if (!email || !password) return reject();

        const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
        if (rows.length === 0) return reject();

        const ok = await verifyPassword(rows[0].password_hash, password);
        if (!ok) return reject();

        const session = await createSession(rows[0].id);
        const csrfToken = generateToken();
        res.cookie('session', session.id, { ...SESSION_COOKIE_OPTS, expires: session.expiresAt });
        res.cookie('csrf', csrfToken, { ...CSRF_COOKIE_OPTS, expires: session.expiresAt });
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

authRouter.post('/logout', async (req, res, next) => {
    try {
        const sessionId = req.cookies?.session;
        if (sessionId) await destroySession(sessionId);
        res.clearCookie('session');
        res.clearCookie('csrf');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

export default authRouter;
```

- [ ] **Step 2: Mount it in `server/src/app.js`**

Add near the top: `import authRouter from './routes/auth.js';`
Add directly above the `/health/session-check` probe route: `app.use('/auth', authRouter);`

- [ ] **Step 3: Write the failing test — `server/test/auth.test.js`**

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(() => resetDb());

test('login with correct credentials sets session and csrf cookies', async () => {
    const user = await createTestUser();
    const res = await loginTestUser(baseUrl, user.email, user.password);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('session=')));
    assert.ok(cookies.some(c => c.startsWith('csrf=')));
});

test('login with wrong password returns generic 401', async () => {
    const user = await createTestUser();
    const res = await loginTestUser(baseUrl, user.email, 'totally wrong password');
    assert.equal(res.status, 401);
});

test('login with unknown email returns the same generic 401', async () => {
    const res = await loginTestUser(baseUrl, 'nobody@example.com', 'whatever password here');
    assert.equal(res.status, 401);
});

test('6th login attempt within 15 minutes is rate limited', async () => {
    const user = await createTestUser();
    for (let i = 0; i < 5; i++) {
        await loginTestUser(baseUrl, user.email, 'wrong password each time');
    }
    const res = await loginTestUser(baseUrl, user.email, 'wrong password each time');
    assert.equal(res.status, 429);
});

test('logout invalidates the session immediately', async () => {
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    const cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { Cookie: cookies } });
    assert.equal(logoutRes.status, 200);

    const probeRes = await fetch(`${baseUrl}/health/session-check`, { headers: { Cookie: cookies } });
    assert.equal(probeRes.status, 401);
});
```

- [ ] **Step 4: Run the tests**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/auth.test.js
```
Expected: all 5 tests PASS. (The rate-limit test takes a few seconds due to 6 sequential requests — acceptable.)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/auth.js server/src/app.js server/test/auth.test.js
git commit -m "server: add login/logout routes with rate limiting"
```

---

### Task 6: Generic CRUD router factory + first five resources (accounts, bills, expenses, incomes, bonuses)

**Files:**
- Create: `server/src/sanitizers/index.js`
- Create: `server/src/crudRouter.js`
- Create: `server/migrations/1755600000001_create-first-crud-tables.js`
- Create: `server/src/routes/accounts.js`, `server/src/routes/bills.js`, `server/src/routes/expenses.js`, `server/src/routes/incomes.js`, `server/src/routes/bonuses.js`
- Modify: `server/src/app.js` — mount the five routers under `/api`
- Test: `server/test/crudResources.test.js`

**Interfaces:**
- Consumes: `query` (Task 1), `requireSession`/`requireCsrf` (Task 4).
- Produces: `createCrudResource({ table, columns, sanitize, requiredFields })` from `server/src/crudRouter.js` — returns an Express Router with `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, all scoped to `req.userId`. `columns` is `{ jsFieldName: 'db_column_name', ... }` and must include `id`. Consumed by every CRUD resource file, including Task 7's remaining five.

- [ ] **Step 1: Re-export the existing sanitizers for server-side use**

Create `server/src/sanitizers/index.js`:
```js
export * from '../../../src/sanitizers.js';
export * from '../../../src/utils.js';
```

Both `src/sanitizers.js` and `src/utils.js` are dependency-free ESM (verified: `sanitizers.js` only imports from `utils.js`, which has no DOM/browser API usage) — this re-export makes them importable from `server/` without duplicating logic.

- [ ] **Step 2: Create the migration — `server/migrations/1755600000001_create-first-crud-tables.js`**

```js
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE accounts (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            type text NOT NULL DEFAULT 'Other',
            starting_balance numeric NOT NULL DEFAULT 0,
            interest_rate numeric NOT NULL DEFAULT 0
        );

        CREATE TABLE bills (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            due_day integer,
            category text NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE expenses (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            budget_amount numeric NOT NULL DEFAULT 0,
            date date,
            category text NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE incomes (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            first_pay_date date,
            frequency text NOT NULL DEFAULT 'biweekly'
        );

        CREATE TABLE bonuses (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            amount numeric NOT NULL DEFAULT 0,
            date date,
            category text NOT NULL DEFAULT 'Other',
            purpose text CHECK (purpose IN ('cashFlow', 'savings'))
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE bonuses; DROP TABLE incomes; DROP TABLE expenses; DROP TABLE bills; DROP TABLE accounts;`);
}
```

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: migration applies cleanly on top of Task 2's.

- [ ] **Step 3: Create `server/src/crudRouter.js`**

```js
import express from 'express';
import { query } from './db.js';

export function createCrudResource({ table, columns, sanitize, requiredFields = [] }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        return out;
    }

    function isMissing(value) {
        return value === null || value === undefined || value === '';
    }

    router.get('/', async (req, res, next) => {
        try {
            const { rows } = await query(
                `SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1 ORDER BY id`,
                [req.userId]
            );
            res.json(rows.map(rowToJson));
        } catch (err) {
            next(err);
        }
    });

    router.post('/', async (req, res, next) => {
        try {
            const clean = sanitize(req.body, Date.now());
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const insertFields = jsFields.filter(f => f !== 'id');
            const insertCols = insertFields.map(f => columns[f]);
            const values = insertFields.map(f => clean[f]);
            const placeholders = insertFields.map((_, i) => `$${i + 2}`);
            const { rows } = await query(
                `INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')}) RETURNING ${dbColumns.join(', ')}`,
                [req.userId, ...values]
            );
            res.status(201).json(rowToJson(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    router.patch('/:id', async (req, res, next) => {
        try {
            if (!/^\d+$/.test(req.params.id)) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            const existing = await query(
                `SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1 AND id = $2`,
                [req.userId, req.params.id]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            const merged = { ...rowToJson(existing.rows[0]), ...req.body };
            const clean = sanitize(merged, existing.rows[0].id);
            if (requiredFields.some(f => isMissing(clean[f]))) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `${requiredFields[0]} is required` } });
            }
            const updateFields = jsFields.filter(f => f !== 'id');
            const setClauses = updateFields.map((f, i) => `${columns[f]} = $${i + 3}`);
            const values = updateFields.map(f => clean[f]);
            const { rows } = await query(
                `UPDATE ${table} SET ${setClauses.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING ${dbColumns.join(', ')}`,
                [req.userId, req.params.id, ...values]
            );
            res.json(rowToJson(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    router.delete('/:id', async (req, res, next) => {
        try {
            if (!/^\d+$/.test(req.params.id)) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            const { rowCount } = await query(`DELETE FROM ${table} WHERE user_id = $1 AND id = $2`, [req.userId, req.params.id]);
            if (rowCount === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    return router;
}
```

- [ ] **Step 4: Create the five resource files**

`server/src/routes/accounts.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeAccount } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'accounts',
    sanitize: sanitizeAccount,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        startingBalance: 'starting_balance',
        interestRate: 'interest_rate'
    }
});
```

`server/src/routes/bills.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeBill } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'bills',
    sanitize: sanitizeBill,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        dueDay: 'due_day',
        category: 'category',
        accountId: 'account_id'
    }
});
```

`server/src/routes/expenses.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeExpense } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'expenses',
    sanitize: sanitizeExpense,
    requiredFields: ['name', 'date'],
    columns: {
        id: 'id',
        name: 'name',
        budgetAmount: 'budget_amount',
        date: 'date',
        category: 'category',
        accountId: 'account_id'
    }
});
```

`server/src/routes/incomes.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeIncome } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'incomes',
    sanitize: sanitizeIncome,
    requiredFields: ['name', 'firstPayDate'],
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        firstPayDate: 'first_pay_date',
        frequency: 'frequency',
        accountId: 'account_id'
    }
});
```

`server/src/routes/bonuses.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeBonus } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'bonuses',
    sanitize: sanitizeBonus,
    requiredFields: ['name', 'date'],
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        date: 'date',
        category: 'category',
        accountId: 'account_id',
        purpose: 'purpose'
    }
});
```

- [ ] **Step 5: Mount all five in `server/src/app.js`**

Add imports:
```js
import { requireSession, requireCsrf } from './auth/middleware.js';
import accountsRouter from './routes/accounts.js';
import billsRouter from './routes/bills.js';
import expensesRouter from './routes/expenses.js';
import incomesRouter from './routes/incomes.js';
import bonusesRouter from './routes/bonuses.js';
```
(`requireSession`/`requireCsrf` are already imported from Task 4 — don't duplicate the import line, just reuse it.)

Add, above the 404 handler:
```js
    const api = express.Router();
    api.use(requireSession, requireCsrf);
    api.use('/accounts', accountsRouter);
    api.use('/bills', billsRouter);
    api.use('/expenses', expensesRouter);
    api.use('/incomes', incomesRouter);
    api.use('/bonuses', bonusesRouter);
    app.use('/api', api);
```

- [ ] **Step 6: Extend `server/test/helpers/testDb.js` to truncate the new tables**

Modify `resetDb()`:
```js
export async function resetDb() {
    await pool.query(
        'TRUNCATE sessions, bonuses, incomes, expenses, bills, accounts, users RESTART IDENTITY CASCADE'
    );
}
```

- [ ] **Step 7: Write the failing test — `server/test/crudResources.test.js`**

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

let accountId;

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const acctRes = await fetch(`${baseUrl}/api/accounts`, {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ name: 'Checking', type: 'checking', startingBalance: 100, interestRate: 0 })
    });
    accountId = (await acctRes.json()).id;
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

export const cases = [
    {
        path: '/api/bills',
        validPayload: () => ({ name: 'Rent', amount: 1200, dueDay: 1, category: 'Housing', accountId }),
        updatePayload: { amount: 1300 },
        updatedField: 'amount',
        updatedValue: 1300,
        invalidPayload: () => ({ amount: 1200 })
    },
    {
        path: '/api/expenses',
        validPayload: () => ({ name: 'Groceries', budgetAmount: 400, date: '2026-08-01', category: 'Food', accountId }),
        updatePayload: { budgetAmount: 450 },
        updatedField: 'budgetAmount',
        updatedValue: 450,
        invalidPayload: () => ({ budgetAmount: 400 })
    },
    {
        path: '/api/incomes',
        validPayload: () => ({ name: 'Paycheck', amount: 2000, firstPayDate: '2026-08-01', frequency: 'biweekly', accountId }),
        updatePayload: { amount: 2100 },
        updatedField: 'amount',
        updatedValue: 2100,
        invalidPayload: () => ({ amount: 2000 })
    },
    {
        path: '/api/bonuses',
        validPayload: () => ({ name: 'Tax refund', amount: 500, date: '2026-08-01', category: 'Other', accountId, purpose: 'savings' }),
        updatePayload: { amount: 600 },
        updatedField: 'amount',
        updatedValue: 600,
        invalidPayload: () => ({ amount: 500 })
    }
];

for (const c of cases) {
    test(`${c.path}: create, list, update, delete round trip`, async () => {
        const createRes = await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.validPayload())
        });
        assert.equal(createRes.status, 201);
        const created = await createRes.json();
        assert.ok(created.id);

        const list = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: cookies } })).json();
        assert.equal(list.length, 1);

        const updateRes = await fetch(`${baseUrl}${c.path}/${created.id}`, {
            method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify(c.updatePayload)
        });
        assert.equal(updateRes.status, 200);
        assert.equal((await updateRes.json())[c.updatedField], c.updatedValue);

        const deleteRes = await fetch(`${baseUrl}${c.path}/${created.id}`, { method: 'DELETE', headers: csrfHeaders() });
        assert.equal(deleteRes.status, 204);

        const listAfter = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: cookies } })).json();
        assert.equal(listAfter.length, 0);
    });

    test(`${c.path}: rejects payload missing a required field`, async () => {
        const res = await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.invalidPayload())
        });
        assert.equal(res.status, 400);
    });

    test(`${c.path}: cannot see or delete another user's rows`, async () => {
        const created = await (await fetch(`${baseUrl}${c.path}`, {
            method: 'POST', headers: csrfHeaders(), body: JSON.stringify(c.validPayload())
        })).json();

        const otherUser = await createTestUser('other@example.com', 'another correct horse battery');
        const otherLoginRes = await loginTestUser(baseUrl, otherUser.email, otherUser.password);
        const otherCookies = otherLoginRes.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
        const otherCsrf = otherCookies.match(/csrf=([^;]+)/)[1];

        const list = await (await fetch(`${baseUrl}${c.path}`, { headers: { Cookie: otherCookies } })).json();
        assert.equal(list.length, 0);

        const deleteRes = await fetch(`${baseUrl}${c.path}/${created.id}`, {
            method: 'DELETE',
            headers: { Cookie: otherCookies, 'X-CSRF-Token': otherCsrf }
        });
        assert.equal(deleteRes.status, 404);
    });
}
```

- [ ] **Step 8: Run the tests**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/crudResources.test.js
```
Expected: all 12 tests (3 per resource × 4 resources) PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/sanitizers server/src/crudRouter.js server/migrations/1755600000001_create-first-crud-tables.js server/src/routes/accounts.js server/src/routes/bills.js server/src/routes/expenses.js server/src/routes/incomes.js server/src/routes/bonuses.js server/src/app.js server/test/helpers/testDb.js server/test/crudResources.test.js
git commit -m "server: add CRUD router factory and first five resources"
```

---

### Task 7: Remaining five CRUD resources (debts, recurringTemplates, emergencyFunds, sinkingFunds, reconciliations)

**Files:**
- Create: `server/migrations/1755600000002_create-remaining-crud-tables.js`
- Create: `server/src/routes/debts.js`, `server/src/routes/recurringTemplates.js`, `server/src/routes/emergencyFunds.js`, `server/src/routes/sinkingFunds.js`, `server/src/routes/reconciliations.js`
- Modify: `server/src/app.js` — mount the five new routers
- Modify: `server/test/helpers/testDb.js` — extend `resetDb()` truncate list
- Modify: `server/test/crudResources.test.js` — append five more cases to the `cases` array

**Interfaces:**
- Consumes: `createCrudResource` (Task 6).
- Produces: nothing new consumed by later tasks — this is the last of the ten standard CRUD resources.

- [ ] **Step 1: Create the migration — `server/migrations/1755600000002_create-remaining-crud-tables.js`**

```js
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE debts (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            category text,
            debt_type text NOT NULL DEFAULT 'creditCard',
            priority integer,
            account_balance numeric NOT NULL DEFAULT 0,
            original_balance numeric NOT NULL DEFAULT 0,
            interest_rate numeric NOT NULL DEFAULT 0,
            minimum_payment numeric NOT NULL DEFAULT 0,
            original_minimum_payment numeric NOT NULL DEFAULT 0,
            due_date integer,
            debt_start_date date,
            fixed_amount numeric,
            fixed_start_date date,
            fixed_end_date date,
            updated_at timestamptz
        );

        CREATE TABLE recurring_templates (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            target_account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            type text NOT NULL DEFAULT 'subscription',
            amount numeric NOT NULL DEFAULT 0,
            frequency text NOT NULL DEFAULT 'monthly',
            day_of_month integer,
            category text NOT NULL DEFAULT 'Other',
            start_date date,
            end_date date,
            paused boolean NOT NULL DEFAULT false,
            skipped_months text[] NOT NULL DEFAULT '{}',
            paid_months text[] NOT NULL DEFAULT '{}'
        );

        CREATE TABLE emergency_funds (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            target_amount numeric NOT NULL DEFAULT 0,
            current_amount numeric NOT NULL DEFAULT 0,
            monthly_contribution numeric NOT NULL DEFAULT 0,
            auto_contribute boolean NOT NULL DEFAULT false,
            notes text
        );

        CREATE TABLE sinking_funds (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            name text NOT NULL,
            allocation_method text NOT NULL DEFAULT 'fixed',
            monthly_allocation numeric NOT NULL DEFAULT 0,
            target_amount numeric NOT NULL DEFAULT 0,
            current_amount numeric NOT NULL DEFAULT 0,
            auto_contribute boolean NOT NULL DEFAULT false,
            notes text
        );

        CREATE TABLE reconciliations (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date NOT NULL,
            previous_balance numeric NOT NULL DEFAULT 0,
            statement_balance numeric NOT NULL,
            difference numeric NOT NULL DEFAULT 0,
            note text,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE reconciliations; DROP TABLE sinking_funds; DROP TABLE emergency_funds; DROP TABLE recurring_templates; DROP TABLE debts;`);
}
```

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: applies cleanly.

- [ ] **Step 2: Create the five resource files**

`server/src/routes/debts.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeDebt } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'debts',
    sanitize: sanitizeDebt,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        category: 'category',
        debtType: 'debt_type',
        priority: 'priority',
        accountId: 'account_id',
        accountBalance: 'account_balance',
        originalBalance: 'original_balance',
        interestRate: 'interest_rate',
        minimumPayment: 'minimum_payment',
        originalMinimumPayment: 'original_minimum_payment',
        dueDate: 'due_date',
        debtStartDate: 'debt_start_date',
        fixedAmount: 'fixed_amount',
        fixedStartDate: 'fixed_start_date',
        fixedEndDate: 'fixed_end_date',
        updatedAt: 'updated_at'
    }
});
```

`server/src/routes/recurringTemplates.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeRecurringTemplate } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'recurring_templates',
    sanitize: sanitizeRecurringTemplate,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        amount: 'amount',
        frequency: 'frequency',
        dayOfMonth: 'day_of_month',
        category: 'category',
        accountId: 'account_id',
        targetAccountId: 'target_account_id',
        startDate: 'start_date',
        endDate: 'end_date',
        paused: 'paused',
        skippedMonths: 'skipped_months',
        paidMonths: 'paid_months'
    }
});
```

`server/src/routes/emergencyFunds.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeEmergencyFund } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'emergency_funds',
    sanitize: sanitizeEmergencyFund,
    requiredFields: ['accountId'],
    columns: {
        id: 'id',
        accountId: 'account_id',
        targetAmount: 'target_amount',
        currentAmount: 'current_amount',
        monthlyContribution: 'monthly_contribution',
        autoContribute: 'auto_contribute',
        notes: 'notes'
    }
});
```

`server/src/routes/sinkingFunds.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeSinkingFund } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'sinking_funds',
    sanitize: sanitizeSinkingFund,
    requiredFields: ['name', 'accountId'],
    columns: {
        id: 'id',
        name: 'name',
        allocationMethod: 'allocation_method',
        monthlyAllocation: 'monthly_allocation',
        targetAmount: 'target_amount',
        currentAmount: 'current_amount',
        autoContribute: 'auto_contribute',
        accountId: 'account_id',
        notes: 'notes'
    }
});
```

`server/src/routes/reconciliations.js`:
```js
import { createCrudResource } from '../crudRouter.js';
import { sanitizeReconciliation } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'reconciliations',
    sanitize: sanitizeReconciliation,
    requiredFields: ['accountId', 'statementBalance'],
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        previousBalance: 'previous_balance',
        statementBalance: 'statement_balance',
        difference: 'difference',
        note: 'note',
        createdAt: 'created_at'
    }
});
```

- [ ] **Step 3: Mount all five in `server/src/app.js`**

Add imports:
```js
import debtsRouter from './routes/debts.js';
import recurringTemplatesRouter from './routes/recurringTemplates.js';
import emergencyFundsRouter from './routes/emergencyFunds.js';
import sinkingFundsRouter from './routes/sinkingFunds.js';
import reconciliationsRouter from './routes/reconciliations.js';
```

Add inside the existing `api` router block from Task 6, after the `bonuses` line:
```js
    api.use('/debts', debtsRouter);
    api.use('/recurring-templates', recurringTemplatesRouter);
    api.use('/emergency-funds', emergencyFundsRouter);
    api.use('/sinking-funds', sinkingFundsRouter);
    api.use('/reconciliations', reconciliationsRouter);
```

- [ ] **Step 4: Extend `resetDb()` in `server/test/helpers/testDb.js`**

```js
export async function resetDb() {
    await pool.query(
        `TRUNCATE sessions, reconciliations, sinking_funds, emergency_funds, recurring_templates, debts,
                  bonuses, incomes, expenses, bills, accounts, users RESTART IDENTITY CASCADE`
    );
}
```

- [ ] **Step 5: Append five more cases to `server/test/crudResources.test.js`**

Add to the `cases` array, after the `bonuses` entry:
```js
    {
        path: '/api/debts',
        validPayload: () => ({ name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, accountId }),
        updatePayload: { accountBalance: 2800 },
        updatedField: 'accountBalance',
        updatedValue: 2800,
        invalidPayload: () => ({ accountBalance: 3000 })
    },
    {
        path: '/api/recurring-templates',
        validPayload: () => ({ name: 'Netflix', type: 'subscription', amount: 15.99, frequency: 'monthly', dayOfMonth: 5, category: 'Entertainment', accountId }),
        updatePayload: { amount: 17.99 },
        updatedField: 'amount',
        updatedValue: 17.99,
        invalidPayload: () => ({ amount: 15.99 })
    },
    {
        path: '/api/emergency-funds',
        validPayload: () => ({ accountId, targetAmount: 10000, currentAmount: 2000, monthlyContribution: 200, autoContribute: true }),
        updatePayload: { currentAmount: 2200 },
        updatedField: 'currentAmount',
        updatedValue: 2200,
        invalidPayload: () => ({ targetAmount: 10000 })
    },
    {
        path: '/api/sinking-funds',
        validPayload: () => ({ name: 'Car Repair', allocationMethod: 'fixed', monthlyAllocation: 100, targetAmount: 1200, currentAmount: 0, accountId }),
        updatePayload: { currentAmount: 100 },
        updatedField: 'currentAmount',
        updatedValue: 100,
        invalidPayload: () => ({ monthlyAllocation: 100 })
    },
    {
        path: '/api/reconciliations',
        validPayload: () => ({ accountId, date: '2026-08-01', previousBalance: 100, statementBalance: 95, difference: -5, note: 'ATM fee' }),
        updatePayload: { note: 'ATM fee corrected' },
        updatedField: 'note',
        updatedValue: 'ATM fee corrected',
        invalidPayload: () => ({ date: '2026-08-01' })
    }
```

- [ ] **Step 6: Run the full CRUD test file**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/crudResources.test.js
```
Expected: 30 tests total (3 × 10 resources) PASS.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/1755600000002_create-remaining-crud-tables.js server/src/routes/debts.js server/src/routes/recurringTemplates.js server/src/routes/emergencyFunds.js server/src/routes/sinkingFunds.js server/src/routes/reconciliations.js server/src/app.js server/test/helpers/testDb.js server/test/crudResources.test.js
git commit -m "server: add remaining five CRUD resources (debts, recurring templates, funds, reconciliations)"
```

---

### Task 8: Keyed-map resources (net worth snapshots, settings, ledger overrides)

**Files:**
- Create: `server/migrations/1755600000003_create-keyed-tables.js`
- Create: `server/src/keyedRouter.js`
- Create: `server/src/routes/netWorthSnapshots.js`, `server/src/routes/settings.js`, `server/src/routes/ledgerOverrides.js`
- Modify: `server/src/app.js` — mount the three new routers
- Modify: `server/test/helpers/testDb.js` — extend `resetDb()` truncate list
- Test: `server/test/keyedResources.test.js`

**Interfaces:**
- Consumes: `query` (Task 1), `sanitizeNetWorthSnapshot`, `sanitizeSetting`, `normalizeText`/`sanitizeFiniteNumber`/`sanitizeInteger`/`sanitizeDateISO` (all via `server/src/sanitizers/index.js`, Task 6).
- Produces: `createKeyedResource({ table, keyColumn, keyField, columns, sanitize })` from `server/src/keyedRouter.js` — `sanitize` has signature `(body, key) => cleanObject | null`. Returns a Router with `GET /`, `PUT /:key`, `DELETE /:key`.

- [ ] **Step 1: Create the migration — `server/migrations/1755600000003_create-keyed-tables.js`**

```js
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE net_worth_snapshots (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date date NOT NULL,
            total_assets numeric NOT NULL DEFAULT 0,
            total_liabilities numeric NOT NULL DEFAULT 0,
            net_worth numeric NOT NULL DEFAULT 0,
            debt_payment_made numeric NOT NULL DEFAULT 0,
            income_received numeric NOT NULL DEFAULT 0,
            source text NOT NULL DEFAULT 'auto',
            PRIMARY KEY (user_id, date)
        );

        CREATE TABLE settings (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key text NOT NULL,
            value jsonb NOT NULL,
            PRIMARY KEY (user_id, key)
        );

        CREATE TABLE ledger_amount_overrides (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            override_key text NOT NULL,
            amount numeric NOT NULL,
            original_amount numeric,
            transaction_name text,
            account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
            date date,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, override_key)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE ledger_amount_overrides; DROP TABLE settings; DROP TABLE net_worth_snapshots;`);
}
```

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: applies cleanly.

- [ ] **Step 2: Create `server/src/keyedRouter.js`**

```js
import express from 'express';
import { query } from './db.js';

export function createKeyedResource({ table, keyColumn, keyField, columns, sanitize }) {
    const router = express.Router();
    const jsFields = Object.keys(columns);
    const dbColumns = Object.values(columns);

    function rowToJson(row) {
        const out = {};
        for (const jsField of jsFields) out[jsField] = row[columns[jsField]];
        return out;
    }

    router.get('/', async (req, res, next) => {
        try {
            const { rows } = await query(`SELECT ${dbColumns.join(', ')} FROM ${table} WHERE user_id = $1`, [req.userId]);
            res.json(rows.map(rowToJson));
        } catch (err) {
            next(err);
        }
    });

    router.put('/:key', async (req, res, next) => {
        try {
            const clean = sanitize(req.body, req.params.key);
            if (!clean) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid payload' } });
            }
            const insertCols = jsFields.map(f => columns[f]);
            const values = jsFields.map(f => clean[f]);
            const placeholders = jsFields.map((_, i) => `$${i + 2}`);
            const updateClauses = jsFields
                .filter(f => f !== keyField)
                .map(f => `${columns[f]} = EXCLUDED.${columns[f]}`);
            const { rows } = await query(
                `INSERT INTO ${table} (user_id, ${insertCols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})
                 ON CONFLICT (user_id, ${keyColumn}) DO UPDATE SET ${updateClauses.join(', ')}
                 RETURNING ${dbColumns.join(', ')}`,
                [req.userId, ...values]
            );
            res.json(rowToJson(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    router.delete('/:key', async (req, res, next) => {
        try {
            const { rowCount } = await query(
                `DELETE FROM ${table} WHERE user_id = $1 AND ${keyColumn} = $2`,
                [req.userId, req.params.key]
            );
            if (rowCount === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
            }
            res.status(204).end();
        } catch (err) {
            next(err);
        }
    });

    return router;
}
```

- [ ] **Step 3: Create the three resource files**

`server/src/routes/netWorthSnapshots.js`:
```js
import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeNetWorthSnapshot } from '../sanitizers/index.js';

export default createKeyedResource({
    table: 'net_worth_snapshots',
    keyColumn: 'date',
    keyField: 'date',
    columns: {
        date: 'date',
        totalAssets: 'total_assets',
        totalLiabilities: 'total_liabilities',
        netWorth: 'net_worth',
        debtPaymentMade: 'debt_payment_made',
        incomeReceived: 'income_received',
        source: 'source'
    },
    sanitize: (body, key) => sanitizeNetWorthSnapshot({ ...body, date: key })
});
```

`server/src/routes/settings.js`:
```js
import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeSetting } from '../sanitizers/index.js';

export default createKeyedResource({
    table: 'settings',
    keyColumn: 'key',
    keyField: 'key',
    columns: { key: 'key', value: 'value' },
    sanitize: (body, key) => {
        const clean = sanitizeSetting({ key, value: body?.value });
        return clean ? { key: clean.key, value: JSON.stringify(clean.value) } : null;
    }
});
```

`server/src/routes/ledgerOverrides.js`:
```js
import { createKeyedResource } from '../keyedRouter.js';
import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO } from '../sanitizers/index.js';

function sanitizeOverrideEntry(body, key) {
    const amount = sanitizeFiniteNumber(body?.amount, NaN);
    if (!Number.isFinite(amount)) return null;
    return {
        overrideKey: key,
        amount,
        originalAmount: sanitizeFiniteNumber(body?.originalAmount, null),
        transactionName: normalizeText(body?.transactionName, 120) || null,
        accountId: sanitizeInteger(body?.accountId, null),
        date: sanitizeDateISO(body?.date),
        updatedAt: sanitizeDateISO(body?.updatedAt) || new Date().toISOString()
    };
}

export default createKeyedResource({
    table: 'ledger_amount_overrides',
    keyColumn: 'override_key',
    keyField: 'overrideKey',
    columns: {
        overrideKey: 'override_key',
        amount: 'amount',
        originalAmount: 'original_amount',
        transactionName: 'transaction_name',
        accountId: 'account_id',
        date: 'date',
        updatedAt: 'updated_at'
    },
    sanitize: sanitizeOverrideEntry
});
```

- [ ] **Step 4: Mount all three in `server/src/app.js`**

Add imports:
```js
import netWorthSnapshotsRouter from './routes/netWorthSnapshots.js';
import settingsRouter from './routes/settings.js';
import ledgerOverridesRouter from './routes/ledgerOverrides.js';
```

Add inside the `api` router block, after the `reconciliations` line:
```js
    api.use('/net-worth-snapshots', netWorthSnapshotsRouter);
    api.use('/settings', settingsRouter);
    api.use('/ledger-overrides', ledgerOverridesRouter);
```

- [ ] **Step 5: Extend `resetDb()` in `server/test/helpers/testDb.js`**

```js
export async function resetDb() {
    await pool.query(
        `TRUNCATE sessions, ledger_amount_overrides, settings, net_worth_snapshots,
                  reconciliations, sinking_funds, emergency_funds, recurring_templates, debts,
                  bonuses, incomes, expenses, bills, accounts, users RESTART IDENTITY CASCADE`
    );
}
```

- [ ] **Step 6: Write the failing test — `server/test/keyedResources.test.js`**

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

test('net-worth-snapshots: PUT upserts by date, GET lists, DELETE removes', async () => {
    const putRes = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ totalAssets: 5000, totalLiabilities: 2000, netWorth: 3000, source: 'manual' })
    });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).netWorth, 3000);

    const putAgain = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, {
        method: 'PUT', headers: csrfHeaders(),
        body: JSON.stringify({ totalAssets: 6000, totalLiabilities: 2000, netWorth: 4000, source: 'manual' })
    });
    assert.equal((await putAgain.json()).netWorth, 4000);

    const list = await (await fetch(`${baseUrl}/api/net-worth-snapshots`, { headers: { Cookie: cookies } })).json();
    assert.equal(list.length, 1);

    const del = await fetch(`${baseUrl}/api/net-worth-snapshots/2026-08-01`, { method: 'DELETE', headers: csrfHeaders() });
    assert.equal(del.status, 204);
});

test('settings: PUT upserts by key with a JSON value', async () => {
    const res = await fetch(`${baseUrl}/api/settings/theme`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ value: 'dark' })
    });
    assert.equal(res.status, 200);
    const list = await (await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookies } })).json();
    assert.equal(list[0].value, 'dark');
});

test('settings: rejects an unsupported value type', async () => {
    const res = await fetch(`${baseUrl}/api/settings/theme`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ value: { nested: true } })
    });
    assert.equal(res.status, 400);
});

test('ledger-overrides: PUT upserts a compound-key entry', async () => {
    const key = encodeURIComponent('debt|123|4|2026-08-01');
    const res = await fetch(`${baseUrl}/api/ledger-overrides/${key}`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ amount: 250.5, transactionName: 'Extra payment' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.amount, 250.5);
    assert.equal(body.transactionName, 'Extra payment');
});

test('ledger-overrides: rejects a non-finite amount', async () => {
    const key = encodeURIComponent('debt|123|4|2026-08-01');
    const res = await fetch(`${baseUrl}/api/ledger-overrides/${key}`, {
        method: 'PUT', headers: csrfHeaders(), body: JSON.stringify({ transactionName: 'no amount' })
    });
    assert.equal(res.status, 400);
});
```

- [ ] **Step 7: Run the tests**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/keyedResources.test.js
```
Expected: all 5 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/1755600000003_create-keyed-tables.js server/src/keyedRouter.js server/src/routes/netWorthSnapshots.js server/src/routes/settings.js server/src/routes/ledgerOverrides.js server/src/app.js server/test/helpers/testDb.js server/test/keyedResources.test.js
git commit -m "server: add keyed-map resources (net worth snapshots, settings, ledger overrides)"
```

---

### Task 9: Singleton plan-settings resource + net-worth milestones

**Files:**
- Create: `server/migrations/1755600000004_create-plan-settings.js`
- Create: `server/src/routes/planSettings.js`
- Modify: `server/src/app.js` — mount the new router
- Modify: `server/test/helpers/testDb.js` — extend `resetDb()` truncate list
- Test: `server/test/planSettings.test.js`

**Interfaces:**
- Consumes: `query` (Task 1), `normalizeText`/`sanitizeFiniteNumber`/`sanitizeInteger` (via `server/src/sanitizers/index.js`).
- Produces: nothing new consumed by later tasks — this is the last data resource.

- [ ] **Step 1: Create the migration — `server/migrations/1755600000004_create-plan-settings.js`**

```js
export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE plan_settings (
            user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            strategy text,
            monthly_payment numeric,
            per_month_stimulus numeric[] NOT NULL DEFAULT '{}',
            ledger_settings jsonb NOT NULL DEFAULT '{"accountFilter":"all","dateRange":"all","sortKey":"date","sortDir":"desc"}',
            forecast_settings jsonb NOT NULL DEFAULT '{"rangeMonths":1,"accountId":"total","notableThresholdPct":130}'
        );

        CREATE TABLE net_worth_milestones_awarded (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            milestone integer NOT NULL,
            PRIMARY KEY (user_id, milestone)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE net_worth_milestones_awarded; DROP TABLE plan_settings;`);
}
```

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: applies cleanly.

- [ ] **Step 2: Create `server/src/routes/planSettings.js`**

```js
import express from 'express';
import { query } from '../db.js';
import { normalizeText, sanitizeFiniteNumber, sanitizeInteger } from '../sanitizers/index.js';

const router = express.Router();

const DEFAULT_LEDGER_SETTINGS = { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc' };
const DEFAULT_FORECAST_SETTINGS = { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 };

function rowToJson(row, milestones) {
    return {
        strategy: row.strategy,
        monthlyPayment: row.monthly_payment === null ? null : Number(row.monthly_payment),
        perMonthStimulus: row.per_month_stimulus.map(Number),
        ledgerSettings: row.ledger_settings,
        forecastSettings: row.forecast_settings,
        netWorthMilestonesAwarded: milestones
    };
}

async function getOrCreateRow(userId) {
    const existing = await query('SELECT * FROM plan_settings WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) return existing.rows[0];
    const { rows } = await query(
        `INSERT INTO plan_settings (user_id, ledger_settings, forecast_settings)
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, JSON.stringify(DEFAULT_LEDGER_SETTINGS), JSON.stringify(DEFAULT_FORECAST_SETTINGS)]
    );
    return rows[0];
}

router.get('/', async (req, res, next) => {
    try {
        const row = await getOrCreateRow(req.userId);
        const milestones = await query(
            'SELECT milestone FROM net_worth_milestones_awarded WHERE user_id = $1 ORDER BY milestone',
            [req.userId]
        );
        res.json(rowToJson(row, milestones.rows.map(r => r.milestone)));
    } catch (err) {
        next(err);
    }
});

router.patch('/', async (req, res, next) => {
    try {
        await getOrCreateRow(req.userId);
        const body = req.body || {};
        const strategy = body.strategy === undefined ? undefined : (normalizeText(body.strategy, 30) || null);
        const monthlyPayment = body.monthlyPayment === undefined ? undefined : sanitizeFiniteNumber(body.monthlyPayment, null, { min: 0 });
        const perMonthStimulus = Array.isArray(body.perMonthStimulus)
            ? body.perMonthStimulus.map(v => sanitizeFiniteNumber(v, 0, { min: 0 }))
            : undefined;
        const ledgerSettings = body.ledgerSettings === undefined ? undefined : {
            accountFilter: normalizeText(body.ledgerSettings?.accountFilter, 20) || 'all',
            dateRange: normalizeText(body.ledgerSettings?.dateRange, 20) || 'all',
            sortKey: normalizeText(body.ledgerSettings?.sortKey, 20) || 'date',
            sortDir: body.ledgerSettings?.sortDir === 'asc' ? 'asc' : 'desc'
        };
        const forecastSettings = body.forecastSettings === undefined ? undefined : {
            rangeMonths: [1, 2, 3, 6, 12].includes(sanitizeInteger(body.forecastSettings?.rangeMonths, 1)) ? sanitizeInteger(body.forecastSettings?.rangeMonths, 1) : 1,
            accountId: body.forecastSettings?.accountId === 'total' ? 'total' : (normalizeText(body.forecastSettings?.accountId, 30) || 'total'),
            notableThresholdPct: sanitizeFiniteNumber(body.forecastSettings?.notableThresholdPct, 130, { min: 100, max: 500 })
        };

        const sets = [];
        const values = [req.userId];
        if (strategy !== undefined) { values.push(strategy); sets.push(`strategy = $${values.length}`); }
        if (monthlyPayment !== undefined) { values.push(monthlyPayment); sets.push(`monthly_payment = $${values.length}`); }
        if (perMonthStimulus !== undefined) { values.push(perMonthStimulus); sets.push(`per_month_stimulus = $${values.length}`); }
        if (ledgerSettings !== undefined) { values.push(JSON.stringify(ledgerSettings)); sets.push(`ledger_settings = $${values.length}`); }
        if (forecastSettings !== undefined) { values.push(JSON.stringify(forecastSettings)); sets.push(`forecast_settings = $${values.length}`); }

        if (sets.length > 0) {
            await query(`UPDATE plan_settings SET ${sets.join(', ')} WHERE user_id = $1`, values);
        }
        const row = await getOrCreateRow(req.userId);
        const milestones = await query(
            'SELECT milestone FROM net_worth_milestones_awarded WHERE user_id = $1 ORDER BY milestone',
            [req.userId]
        );
        res.json(rowToJson(row, milestones.rows.map(r => r.milestone)));
    } catch (err) {
        next(err);
    }
});

router.post('/milestones', async (req, res, next) => {
    try {
        const milestone = sanitizeInteger(req.body?.milestone, null, { min: 5000 });
        if (milestone === null) {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'milestone must be an integer >= 5000' } });
        }
        await query(
            'INSERT INTO net_worth_milestones_awarded (user_id, milestone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [req.userId, milestone]
        );
        res.status(201).json({ milestone });
    } catch (err) {
        next(err);
    }
});

export default router;
```

- [ ] **Step 3: Mount it in `server/src/app.js`**

Add import: `import planSettingsRouter from './routes/planSettings.js';`

Add inside the `api` router block, after the `ledger-overrides` line:
```js
    api.use('/plan-settings', planSettingsRouter);
```

- [ ] **Step 4: Extend `resetDb()` in `server/test/helpers/testDb.js`**

```js
export async function resetDb() {
    await pool.query(
        `TRUNCATE sessions, net_worth_milestones_awarded, plan_settings,
                  ledger_amount_overrides, settings, net_worth_snapshots,
                  reconciliations, sinking_funds, emergency_funds, recurring_templates, debts,
                  bonuses, incomes, expenses, bills, accounts, users RESTART IDENTITY CASCADE`
    );
}
```

- [ ] **Step 5: Write the failing test — `server/test/planSettings.test.js`**

```js
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

let server, baseUrl, cookies;

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrfToken };
}

test('GET returns defaults on first access', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.strategy, null);
    assert.deepEqual(body.ledgerSettings, { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc' });
    assert.deepEqual(body.netWorthMilestonesAwarded, []);
});

test('PATCH updates only the fields provided', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ strategy: 'avalanche', monthlyPayment: 500 })
    });
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ monthlyPayment: 600 })
    });
    const body = await res.json();
    assert.equal(body.strategy, 'avalanche');
    assert.equal(body.monthlyPayment, 600);
});

test('POST /milestones appends a milestone and ignores duplicates', async () => {
    const first = await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 10000 })
    });
    assert.equal(first.status, 201);

    await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 10000 })
    });

    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    const body = await res.json();
    assert.deepEqual(body.netWorthMilestonesAwarded, [10000]);
});

test('POST /milestones rejects a milestone below 5000', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings/milestones`, {
        method: 'POST', headers: csrfHeaders(), body: JSON.stringify({ milestone: 100 })
    });
    assert.equal(res.status, 400);
});
```

- [ ] **Step 6: Run the tests**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
node --test test/planSettings.test.js
```
Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/1755600000004_create-plan-settings.js server/src/routes/planSettings.js server/src/app.js server/test/helpers/testDb.js server/test/planSettings.test.js
git commit -m "server: add singleton plan-settings resource and net-worth milestones"
```

---

### Task 10: Docker Compose + nginx wiring

**Files:**
- Modify: `docker-compose.yml` — add `postgres` and `server` services
- Modify: `nginx.conf` — add `/api/` reverse-proxy location
- Create: `secrets/postgres_password.txt.example`
- Modify: `.gitignore` — add `secrets/*.txt` (excluding the `.example` file)
- Create: `server/Dockerfile`

**Interfaces:**
- Consumes: everything from Tasks 1-9 (the full `server/` app).
- Produces: a deployable stack — no new JS interfaces for later tasks to consume (this is the last infra task).

- [ ] **Step 1: Create `server/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Add `secrets/postgres_password.txt.example`**

```
changeme-generate-a-real-random-password
```

Modify `.gitignore`, adding under the "Environment & secrets" section:
```
secrets/*.txt
!secrets/*.txt.example
```

- [ ] **Step 3: Add `postgres` and `server` services to `docker-compose.yml`**

Modify `docker-compose.yml`, appending after the existing `myfinances` service (keep its definition unchanged):
```yaml
  postgres:
    image: postgres:16-alpine
    container_name: myfinances-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: myfinances
      POSTGRES_USER: myfinances
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
    secrets:
      - postgres_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myfinances -d myfinances"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build:
      context: ./server
    image: myfinances-server:latest
    container_name: myfinances-server
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://myfinances:${POSTGRES_PASSWORD}@postgres:5432/myfinances
      SESSION_TTL_DAYS: "7"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  postgres-data:

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
```

- [ ] **Step 4: Add the `/api/` proxy location to `nginx.conf`**

Read `nginx.conf` first to find its existing `server { ... }` block and `location /` directive, then add a new `location /api/` block directly above it that proxies to the `server` container:
```nginx
    location /api/ {
        proxy_pass http://server:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /auth/ {
        proxy_pass http://server:4000/auth/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

- [ ] **Step 5: Verify the full stack starts and the API is reachable through nginx**

Run:
```bash
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
export POSTGRES_PASSWORD=$(cat secrets/postgres_password.txt)
docker compose up -d --build
docker compose exec server npm run migrate up
docker compose exec server node scripts/create-user.js <<< $'owner@example.com\ncorrect horse battery staple\n'
curl -s http://localhost:5500/api/accounts -o /dev/null -w '%{http_code}\n'
```
Expected: the last `curl` prints `401` (unauthenticated, proving nginx routed the request through to the `server` container rather than 404ing) — not `502`/`504`/connection-refused, which would indicate the proxy or the `server` container itself is broken.

- [ ] **Step 6: Tear down and commit**

```bash
docker compose down
rm secrets/postgres_password.txt
git add docker-compose.yml nginx.conf secrets/postgres_password.txt.example .gitignore server/Dockerfile
git commit -m "infra: wire postgres and server containers into docker-compose, proxy /api and /auth through nginx"
```

---

### Task 11: Backend integration test runner + docs

**Files:**
- Create: `server/README.md`
- Modify: `CLAUDE.md` — new "Backend service (optional, Phase 1)" section
- Modify: `CHANGELOG.md`
- Modify: `src/utils.js` — bump `APP_VERSION`
- Modify: `ROADMAP.md` — mark the migration-framework BED item delivered

**Interfaces:**
- Consumes: nothing new — this task only documents what Tasks 1-10 built.

- [ ] **Step 1: Create `server/README.md`**

```markdown
# MyFinances Server (Phase 1)

Self-hosted Node.js + PostgreSQL backend for MyFinances multi-device sync.
Optional — the browser app works fully without this; see the root
`CLAUDE.md` for how it fits into the overall architecture.

## Local development

    cp .env.example .env   # edit DATABASE_URL to point at a local Postgres
    npm install
    npm run migrate up
    npm run create-user
    npm start

## Tests

Tests require a real Postgres instance (never mocked):

    docker compose -f docker-compose.test.yml up -d
    export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
    npm run migrate up
    npm test

## Production

See the root `docker-compose.yml` (`postgres` and `server` services) and
`nginx.conf`'s `/api/` and `/auth/` proxy blocks.
```

- [ ] **Step 2: Add the CLAUDE.md section**

Modify `CLAUDE.md`, adding a new subsection under "### Cross-cutting features" (after the existing PWA bullet):

```markdown
- **Backend service (optional, Phase 1)** — `server/` is a self-hosted Node.js + PostgreSQL API added under issue #53, providing multi-device sync/durability as an *additional* opt-in deployment option. It does not change the frontend's core architecture: the browser app still runs fully offline against `localStorage`/`sessionStorage` with zero setup, and Postgres is a third storage backend a user can point the app at, not a replacement. See `docs/superpowers/specs/2026-08-19-postgresql-storage-phase1-design.md` and `server/README.md`. Frontend integration (an async `PostgresAdapter`, login UI, Settings backend picker) is a separate, not-yet-built Phase 2.
```

- [ ] **Step 3: Bump `APP_VERSION` in `src/utils.js`**

Read the current value (was `4.20.0` as of the design spec) and increment the minor version, e.g. to `4.21.0`, in the `export const APP_VERSION = '...'` line.

- [ ] **Step 4: Add the CHANGELOG.md entry**

Add at the top of `CHANGELOG.md`, matching the existing heading format (check the file's most recent entry for exact date/format conventions):
```markdown
## [4.21.0] — 2026-08-19
### Added
- Self-hosted PostgreSQL storage backend (Phase 1, issue #53): a standalone Node.js API (`server/`) with relational tables and granular REST endpoints for every record type, secured by argon2id password hashing and server-side sessions. Opt-in — the browser app's local-only, zero-setup mode is unchanged. Frontend integration is a separate, upcoming Phase 2.
```

- [ ] **Step 5: Update ROADMAP.md**

Modify the existing `~~**Formal storage-schema migration framework**~~` handling: find the current (not-yet-struck-through) "Formal storage-schema migration framework" bullet under "🗄️ BED (Storage / data-layer logic)" and mark it delivered:
```markdown
- ~~**Formal storage-schema migration framework**~~ ✅ **Delivered August 19, 2026 (#53, Phase 1)** — the new self-hosted Postgres backend (`server/migrations/`, via `node-pg-migrate`) has an explicit migration pipeline; the localStorage JSON blob's sanitizer-based migration is unaffected and continues to serve local-only users, who remain fully supported.
```

- [ ] **Step 6: Verify the versioning test still passes**

Run:
```bash
python -m pytest tests/features/test_versioning.py -v
```
Expected: PASS — confirms `APP_VERSION` and the new `CHANGELOG.md` heading stay in sync per the existing repo convention.

- [ ] **Step 7: Commit**

```bash
git add server/README.md CLAUDE.md CHANGELOG.md src/utils.js ROADMAP.md
git commit -m "docs: document Phase 1 backend service, bump APP_VERSION to 4.21.0"
```

---

### Task 12: Full backend test suite run (final verification)

**Files:** none (verification-only task)

- [ ] **Step 1: Ensure the test database is up to date**

Run:
```bash
cd server
docker compose -f docker-compose.test.yml up -d
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npx node-pg-migrate up --migrations-dir migrations
```
Expected: all 5 migrations report as already applied or newly applied with no errors.

- [ ] **Step 2: Run the entire backend suite**

Run:
```bash
cd server
export DATABASE_URL="postgres://myfinances_test:myfinances_test@localhost:5433/myfinances_test"
npm test
```
Expected: every test across `app.test.js`, `migrations.test.js`, `argon2.test.js`, `middleware.test.js`, `auth.test.js`, `crudResources.test.js`, `keyedResources.test.js`, `planSettings.test.js` PASSes — 0 failures.

- [ ] **Step 3: Run the existing Playwright suite to confirm zero regressions to the untouched frontend**

Run:
```bash
python -m http.server 5500 &
python -m pytest tests/ -v
```
Expected: same pass/fail counts as before this plan started (this plan makes no changes under `src/`, `tests/`, or `index.html`, so no delta is expected).

- [ ] **Step 4: Tear down the test database**

Run:
```bash
cd server && docker compose -f docker-compose.test.yml down
```

No commit for this task — it's verification-only.
