// Issue #456: new-password policy, optional Have I Been Pwned range check,
// change-password, and session revocation on change/reset.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { isPasswordBreached } from '../src/auth/breachedPasswords.js';

const STRONG = 'violet harbor lantern 42';
const STRONG_2 = 'quiet maple orbit canyon';
const ENV_KEYS = ['ALLOW_SETUP', 'SECURITY_CHECK_BREACHED_PASSWORDS', 'SECURITY_BREACH_CHECK_URL', 'SECURITY_BREACH_CHECK_TIMEOUT_MS'];
const savedEnv = {};

// A local stand-in for api.pwnedpasswords.com. `hibp.respond` decides each
// answer; `hibp.requests` records what the server sent.
const hibp = { server: null, url: '', requests: [], respond: null };

function sha1Upper(s) {
    return createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
}
function rangeBodyFor(password, count) {
    const suffix = sha1Upper(password).slice(5);
    // Padding-style decoys plus the real entry.
    return `0000000000000000000000000000000000A:0\r\n${suffix}:${count}\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3\r\n`;
}

before(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.ALLOW_SETUP = 'true';
    hibp.server = http.createServer((req, res) => {
        hibp.requests.push({ url: req.url, headers: req.headers });
        const answer = hibp.respond ? hibp.respond(req) : { status: 200, body: '' };
        if (answer.hang) return; // never answers: exercises the timeout
        res.writeHead(answer.status, { 'Content-Type': 'text/plain' });
        res.end(answer.body);
    });
    await new Promise(r => hibp.server.listen(0, '127.0.0.1', r));
    hibp.url = `http://127.0.0.1:${hibp.server.address().port}/range/`;
});

after(async () => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
    hibp.server.closeAllConnections?.();
    await new Promise(r => hibp.server.close(r));
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    delete process.env.SECURITY_CHECK_BREACHED_PASSWORDS;
    process.env.SECURITY_BREACH_CHECK_URL = hibp.url;
    delete process.env.SECURITY_BREACH_CHECK_TIMEOUT_MS;
    hibp.requests = [];
    hibp.respond = null;
});

// Each test gets its own app so rate-limit counters never bleed between tests.
async function withApp(fn) {
    const server = createApp().listen(0);
    try {
        return await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.close();
    }
}

function register(baseUrl, email, password) {
    return fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
}

async function signIn(baseUrl, user) {
    const res = await loginTestUser(baseUrl, user.email, user.password);
    assert.equal(res.status, 200);
    const cookies = res.headers.getSetCookie();
    const session = cookies.find(c => c.startsWith('session=')).split(';')[0];
    const csrf = cookies.find(c => c.startsWith('csrf=')).split(';')[0];
    return { cookie: `${session}; ${csrf}`, csrf: csrf.slice('csrf='.length) };
}

function changePassword(baseUrl, auth, body, { withCsrf = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Cookie = auth.cookie;
    if (auth && withCsrf) headers['X-CSRF-Token'] = auth.csrf;
    return fetch(`${baseUrl}/auth/change-password`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function sessionStatus(baseUrl, auth) {
    return fetch(`${baseUrl}/health/session-check`, { headers: { Cookie: auth.cookie } }).then(r => r.status);
}

async function insertResetToken(userId) {
    const token = randomBytes(32).toString('hex');
    await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')",
        [userId, createHash('sha256').update(token).digest('hex')]
    );
    return token;
}

function resetPassword(baseUrl, token, newPassword) {
    return fetch(`${baseUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
    });
}

async function expectReason(res, reason) {
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_FAILED');
    assert.equal(body.error.reason, reason);
    assert.ok(body.error.message);
}

// ---------------------------------------------------------------- policy endpoint

test('GET /auth/password-policy reports the limits and that the breach check is off by default', async () => {
    await withApp(async (baseUrl) => {
        const body = await (await fetch(`${baseUrl}/auth/password-policy`)).json();
        assert.deepEqual(body, { minLength: 15, maxLength: 128, breachedCheckEnabled: false });
    });
});

test('GET /auth/password-policy reports breachedCheckEnabled when the flag is on', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    await withApp(async (baseUrl) => {
        const body = await (await fetch(`${baseUrl}/auth/password-policy`)).json();
        assert.equal(body.breachedCheckEnabled, true);
    });
});

// ---------------------------------------------------------------- register policy

test('register accepts exactly 15 characters (boundary)', async () => {
    await withApp(async (baseUrl) => {
        assert.equal((await register(baseUrl, 'owner@example.com', 'violet harbor 9')).status, 200);
    });
});

test('register rejects 14 characters with reason PASSWORD_TOO_SHORT', async () => {
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', 'fourteen chars'), 'PASSWORD_TOO_SHORT');
    });
});

test('register counts characters, not UTF-16 units (15 emoji/accented code points pass)', async () => {
    await withApp(async (baseUrl) => {
        // 15 code points, 16+ UTF-16 units: an astral emoji counts once.
        assert.equal((await register(baseUrl, 'owner@example.com', 'żółw 🐢 gęś łoś!')).status, 200);
    });
});

test('register rejects 129 characters and accepts 128 (boundaries)', async () => {
    const words = 'amber birch cobalt delta ember fjord granite harbor indigo juniper kestrel lagoon meadow nectar oasis prairie quartz';
    const p128 = (words + ' ' + words).slice(0, 128);
    assert.equal([...p128].length, 128);
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', p128 + 'x'), 'PASSWORD_TOO_LONG');
        assert.equal((await register(baseUrl, 'owner@example.com', p128)).status, 200);
    });
});

test('register rejects repetitive and sequential passwords', async () => {
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', '123456789012345'), 'PASSWORD_REPETITIVE');
        await expectReason(await register(baseUrl, 'owner@example.com', 'abcabcabcabcabcabc'), 'PASSWORD_REPETITIVE');
        await expectReason(await register(baseUrl, 'owner@example.com', 'qwertyuiopasdfgh'), 'PASSWORD_REPETITIVE');
    });
});

test('register rejects a common password padded with digits (bundled list)', async () => {
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', 'Password123456789!'), 'PASSWORD_COMMON');
    });
});

test('register rejects a password containing the email name or the app name', async () => {
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'budgetfan@example.com', 'budgetfan rules the world'), 'PASSWORD_CONTEXT');
        await expectReason(await register(baseUrl, 'owner@example.com', 'my MyFinances vault key'), 'PASSWORD_CONTEXT');
    });
});

test('register rejects a non-string password without crashing', async () => {
    await withApp(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'owner@example.com', password: ['x'.repeat(20)] })
        });
        assert.equal(res.status, 400);
    });
});

// ---------------------------------------------------------------- breach check

test('flag off: the breach service is never contacted', async () => {
    await withApp(async (baseUrl) => {
        assert.equal((await register(baseUrl, 'owner@example.com', STRONG)).status, 200);
    });
    assert.equal(hibp.requests.length, 0);
});

test('flag on: a breached password is rejected with PASSWORD_BREACHED', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 200, body: rangeBodyFor(STRONG, 42) });
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', STRONG), 'PASSWORD_BREACHED');
    });
});

test('flag on: only the 5-character SHA-1 prefix is sent, with padding requested', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 200, body: rangeBodyFor('something else entirely', 1) });
    await withApp(async (baseUrl) => {
        assert.equal((await register(baseUrl, 'owner@example.com', STRONG)).status, 200);
    });
    assert.equal(hibp.requests.length, 1);
    assert.equal(hibp.requests[0].url, `/range/${sha1Upper(STRONG).slice(0, 5)}`);
    assert.equal(hibp.requests[0].headers['add-padding'], 'true');
    assert.ok(!hibp.requests[0].url.includes(sha1Upper(STRONG).slice(5)));
});

test('flag on: a padding entry (count 0) for the same suffix is not a breach', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 200, body: rangeBodyFor(STRONG, 0) });
    assert.equal(await isPasswordBreached(STRONG), false);
});

test('flag on: the policy runs first, so a short password never reaches the breach service', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    await withApp(async (baseUrl) => {
        await expectReason(await register(baseUrl, 'owner@example.com', 'short'), 'PASSWORD_TOO_SHORT');
    });
    assert.equal(hibp.requests.length, 0);
});

test('fails open on an HTTP error from the breach service', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 503, body: 'down' });
    await withApp(async (baseUrl) => {
        assert.equal((await register(baseUrl, 'owner@example.com', STRONG)).status, 200);
    });
});

test('fails open when the breach service times out', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    process.env.SECURITY_BREACH_CHECK_TIMEOUT_MS = '200';
    hibp.respond = () => ({ hang: true });
    assert.equal(await isPasswordBreached(STRONG), false);
});

test('fails open when the breach service is unreachable (no egress)', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    process.env.SECURITY_BREACH_CHECK_URL = 'http://127.0.0.1:1/range/';
    assert.equal(await isPasswordBreached(STRONG), false);
});

// ---------------------------------------------------------------- change password

test('change-password requires a session', async () => {
    await withApp(async (baseUrl) => {
        const res = await changePassword(baseUrl, null, { currentPassword: 'x', newPassword: STRONG });
        assert.equal(res.status, 401);
    });
});

test('change-password requires the CSRF header', async () => {
    const user = await createTestUser();
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        const res = await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: STRONG }, { withCsrf: false });
        assert.equal(res.status, 403);
    });
});

test('change-password rejects a wrong current password and keeps the old one', async () => {
    const user = await createTestUser();
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        const res = await changePassword(baseUrl, auth, { currentPassword: 'not my password at all', newPassword: STRONG });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, 'INVALID_CURRENT_PASSWORD');
        assert.equal((await loginTestUser(baseUrl, user.email, user.password)).status, 200);
    });
});

test('change-password rejects reusing the current password', async () => {
    const user = await createTestUser();
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        await expectReason(await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: user.password }), 'PASSWORD_UNCHANGED');
    });
});

test('change-password applies the policy (too short, context, breached)', async () => {
    const user = await createTestUser('budgetfan@example.com');
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 200, body: rangeBodyFor(STRONG, 9) });
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        await expectReason(await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: 'short one' }), 'PASSWORD_TOO_SHORT');
        await expectReason(await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: 'budgetfan forever and ever' }), 'PASSWORD_CONTEXT');
        await expectReason(await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: STRONG }), 'PASSWORD_BREACHED');
    });
});

test('change-password succeeds, signs out other sessions only, and invalidates reset links and the calendar token', async () => {
    const user = await createTestUser();
    await pool.query("INSERT INTO plan_settings (user_id, calendar_token) VALUES ($1, 'feedtoken')", [user.id]);
    const pendingReset = await insertResetToken(user.id);
    await withApp(async (baseUrl) => {
        const mine = await signIn(baseUrl, user);
        const otherDevice = await signIn(baseUrl, user);

        const res = await changePassword(baseUrl, mine, { currentPassword: user.password, newPassword: STRONG });
        assert.equal(res.status, 200);

        assert.equal(await sessionStatus(baseUrl, mine), 200, 'the session that changed the password stays signed in');
        assert.equal(await sessionStatus(baseUrl, otherDevice), 401, 'other sessions are revoked');
        assert.equal((await loginTestUser(baseUrl, user.email, user.password)).status, 401, 'old password no longer works');
        assert.equal((await loginTestUser(baseUrl, user.email, STRONG)).status, 200, 'new password works');

        const { rows } = await pool.query('SELECT calendar_token FROM plan_settings WHERE user_id = $1', [user.id]);
        assert.equal(rows[0].calendar_token, null);
        assert.equal((await resetPassword(baseUrl, pendingReset, STRONG_2)).status, 400, 'pending reset link is spent');
    });
});

test('6th failed change-password attempt within 15 minutes is rate limited', async () => {
    const user = await createTestUser();
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        for (let i = 0; i < 5; i++) {
            await changePassword(baseUrl, auth, { currentPassword: `wrong guess number ${i}`, newPassword: STRONG });
        }
        const res = await changePassword(baseUrl, auth, { currentPassword: user.password, newPassword: STRONG });
        assert.equal(res.status, 429);
    });
});

// ---------------------------------------------------------------- reset password

test('reset-password applies the policy and leaves the token usable for a retry', async () => {
    const user = await createTestUser();
    const token = await insertResetToken(user.id);
    await withApp(async (baseUrl) => {
        await expectReason(await resetPassword(baseUrl, token, 'too short'), 'PASSWORD_TOO_SHORT');
        assert.equal((await resetPassword(baseUrl, token, STRONG)).status, 200);
        assert.equal((await loginTestUser(baseUrl, user.email, STRONG)).status, 200);
    });
});

test('reset-password with an invalid token is INVALID_TOKEN even for a weak password, and never calls the breach service', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    await withApp(async (baseUrl) => {
        const res = await resetPassword(baseUrl, 'badtoken', STRONG);
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, 'INVALID_TOKEN');
    });
    assert.equal(hibp.requests.length, 0);
});

test('a successful reset signs out every session', async () => {
    const user = await createTestUser();
    const token = await insertResetToken(user.id);
    await withApp(async (baseUrl) => {
        const auth = await signIn(baseUrl, user);
        assert.equal((await resetPassword(baseUrl, token, STRONG)).status, 200);
        assert.equal(await sessionStatus(baseUrl, auth), 401);
    });
});

// ---------------------------------------------------------------- login unchanged

test('login is unchanged: an existing 12-character password still signs in', async () => {
    const user = await createTestUser('legacy@example.com', '12characters');
    await withApp(async (baseUrl) => {
        assert.equal((await loginTestUser(baseUrl, user.email, user.password)).status, 200);
    });
});

// ---------------------------------------------------------------- review hardening

test('fails open (no redirect followed) when the breach service redirects', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    hibp.respond = () => ({ status: 302, body: '' });
    // A 302 without Location still must not count as a breach; with
    // redirect: 'error' a real redirect throws and fails open too.
    assert.equal(await isPasswordBreached(STRONG), false);
});

test('fails open when the breach service sends an oversized body', async () => {
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    const suffix = sha1Upper(STRONG).slice(5);
    hibp.respond = () => ({ status: 200, body: 'X'.repeat(600 * 1024) + `\r\n${suffix}:99\r\n` });
    assert.equal(await isPasswordBreached(STRONG), false);
});

test('register after setup answers 409 before any breach lookup', async () => {
    await createTestUser();
    process.env.SECURITY_CHECK_BREACHED_PASSWORDS = 'true';
    await withApp(async (baseUrl) => {
        const res = await register(baseUrl, 'late@example.com', STRONG);
        assert.equal(res.status, 409);
    });
    assert.equal(hibp.requests.length, 0);
});

test('login with a non-string password is a generic 401, not a 500', async () => {
    const user = await createTestUser();
    await withApp(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, password: { $ne: null } })
        });
        assert.equal(res.status, 401);
    });
});
