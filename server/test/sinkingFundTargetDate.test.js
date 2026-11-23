import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { up, down } from '../migrations/1755600000050_add-sinking-fund-target-date.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #680: sinking funds persist their goal date (target_date method only).

let server, baseUrl, cookies, accountId;

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
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await api('POST', '/api/accounts', { name: 'Savings', type: 'savings', startingBalance: 0, interestRate: 0 })).body.id;
});

const fund = (extra) => ({
    name: 'House', allocationMethod: 'target_date', monthlyAllocation: 100, targetAmount: 1200, currentAmount: 0, accountId, ...extra
});

test('POST round-trips targetDate and GET returns it', async () => {
    const created = await api('POST', '/api/sinking-funds', fund({ targetDate: '2027-06-30' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.targetDate, '2027-06-30');
    const list = await api('GET', '/api/sinking-funds');
    assert.equal(list.body.find(x => x.id === created.body.id).targetDate, '2027-06-30');
});

test('an old-shape POST (no targetDate) stores null', async () => {
    const created = await api('POST', '/api/sinking-funds', fund());
    assert.equal(created.status, 201);
    assert.equal(created.body.targetDate, null);
});

test('an invalid date is sanitized to null', async () => {
    const created = await api('POST', '/api/sinking-funds', fund({ targetDate: '2027-02-30' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.targetDate, null);
    const garbage = await api('POST', '/api/sinking-funds', fund({ targetDate: 'next spring' }));
    assert.equal(garbage.body.targetDate, null);
});

test('a non target_date method drops the date', async () => {
    const fixed = await api('POST', '/api/sinking-funds', fund({ allocationMethod: 'fixed', targetDate: '2027-06-30' }));
    assert.equal(fixed.status, 201);
    assert.equal(fixed.body.targetDate, null);
});

test('PATCH changes, keeps (when omitted) and clears the date; changing the method drops it', async () => {
    const id = (await api('POST', '/api/sinking-funds', fund({ targetDate: '2027-06-30' }))).body.id;
    let patched = await api('PATCH', `/api/sinking-funds/${id}`, { targetDate: '2028-01-31' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.targetDate, '2028-01-31');
    patched = await api('PATCH', `/api/sinking-funds/${id}`, { name: 'Renamed' });
    assert.equal(patched.body.targetDate, '2028-01-31');
    patched = await api('PATCH', `/api/sinking-funds/${id}`, { targetDate: null });
    assert.equal(patched.body.targetDate, null);
    patched = await api('PATCH', `/api/sinking-funds/${id}`, { targetDate: '2028-01-31' });
    patched = await api('PATCH', `/api/sinking-funds/${id}`, { allocationMethod: 'fixed' });
    assert.equal(patched.body.targetDate, null);
});

test('migration 050 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
    const collect = async (fn) => {
        const stmts = [];
        await fn({ sql: (s) => stmts.push(s) });
        return stmts;
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cols = () => client.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'sinking_funds' AND column_name = 'target_date'`
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
