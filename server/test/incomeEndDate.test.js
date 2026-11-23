import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { up, down } from '../migrations/1755600000045_add-income-end-date.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #679: incomes carry an optional, inclusive endDate.

let server, baseUrl, cookies, userId, accountId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

function headers() {
    const csrf = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrf };
}

async function api(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    userId = user.id;
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await api('POST', '/api/accounts', { name: 'Checking', type: 'checking', startingBalance: 0, interestRate: 0 })).body.id;
});

const income = (extra) => ({ name: 'Contract', amount: 2000, firstPayDate: '2026-01-10', frequency: 'monthly', accountId, ...extra });

test('POST round-trips endDate and GET returns it', async () => {
    const created = await api('POST', '/api/incomes', income({ endDate: '2026-06-10' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.endDate, '2026-06-10');
    const list = await api('GET', '/api/incomes');
    assert.equal(list.body.find(x => x.id === created.body.id).endDate, '2026-06-10');
});

test('an old-shape POST (no endDate) stores null', async () => {
    const created = await api('POST', '/api/incomes', income());
    assert.equal(created.status, 201);
    assert.equal(created.body.endDate, null);
});

test('an end date before the first pay date is dropped by the sanitizer', async () => {
    const created = await api('POST', '/api/incomes', income({ endDate: '2026-01-09' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.endDate, null);
});

test('PATCH sets, keeps (when omitted) and clears endDate against the stored first pay date', async () => {
    const id = (await api('POST', '/api/incomes', income())).body.id;
    let patched = await api('PATCH', `/api/incomes/${id}`, { endDate: '2026-03-10' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.endDate, '2026-03-10');
    patched = await api('PATCH', `/api/incomes/${id}`, { name: 'Renamed' });
    assert.equal(patched.body.endDate, '2026-03-10');
    // Before the stored first pay date: dropped, even though the body has no firstPayDate.
    patched = await api('PATCH', `/api/incomes/${id}`, { endDate: '2025-12-31' });
    assert.equal(patched.body.endDate, null);
    patched = await api('PATCH', `/api/incomes/${id}`, { endDate: '2026-04-10' });
    patched = await api('PATCH', `/api/incomes/${id}`, { endDate: null });
    assert.equal(patched.body.endDate, null);
});

test('migration 045 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
    const collect = async (fn) => {
        const stmts = [];
        await fn({ sql: (s) => stmts.push(s) });
        return stmts;
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cols = () => client.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'incomes' AND column_name = 'end_date'`
        );
        for (const s of await collect(up)) await client.query(s); // already applied
        assert.equal((await cols()).rowCount, 1);
        for (const s of await collect(down)) await client.query(s);
        assert.equal((await cols()).rowCount, 0);
        for (const s of await collect(down)) await client.query(s);
        for (const s of await collect(up)) await client.query(s);
        assert.equal((await cols()).rowCount, 1);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

// ─── /calendar.ics stops at the end date ────────────────────────────────────

function ymd(y, m, d) {
    const dt = new Date(y, m, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function feedDates(ics, id) {
    const re = new RegExp(`UID:income-${id}-(\\d{8})@myfinances`, 'g');
    return [...ics.matchAll(re)].map(m => m[1]);
}

test('the webcal feed has no paydays after an income\'s end date', async () => {
    const now = new Date();
    const first = ymd(now.getFullYear(), now.getMonth() - 12, 10);
    const end = ymd(now.getFullYear(), now.getMonth(), 10);
    const open = (await api('POST', '/api/incomes', income({ name: 'Open', firstPayDate: first }))).body.id;
    const ended = (await api('POST', '/api/incomes', income({ name: 'Ended', firstPayDate: first, endDate: end }))).body.id;
    const ics = await generateIcsFromDbRows(userId, 'http://localhost');
    const openDates = feedDates(ics, open);
    const endedDates = feedDates(ics, ended);
    assert.equal(openDates.length, 25);
    assert.equal(endedDates.length, 13);
    assert.deepEqual(endedDates, openDates.slice(0, 13));
    assert.equal(endedDates.at(-1), end.replaceAll('-', ''));
});
