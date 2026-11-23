import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { up, down } from '../migrations/1755600000047_add-plan-history-debts.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #312: Plan History entries carry per-debt results.

let server, baseUrl, cookies;

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
});

const entry = (extra) => ({ monthlyPayment: 500, strategy: 'avalanche', totalInterest: 1200, monthsToPayOff: 20, totalDebt: 9000, ...extra });
const DEBTS = [
    { debtId: 1, name: 'Visa', payoffDate: '2027-06-01', totalInterest: 900.25 },
    { debtId: 2, name: 'Loan', payoffDate: null, totalInterest: 299.75 },
];

test('POST round-trips the per-debt list and GET returns it', async () => {
    const created = await api('POST', '/api/plan-history', entry({ debts: DEBTS }));
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.debts, DEBTS);
    const list = await api('GET', '/api/plan-history');
    assert.deepEqual(list.body.find(e => e.id === created.body.id).debts, DEBTS);
});

test('an old-shape POST stores an empty list', async () => {
    const created = await api('POST', '/api/plan-history', entry());
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.debts, []);
});

test('malformed per-debt data is sanitized, not rejected', async () => {
    const created = await api('POST', '/api/plan-history', entry({ debts: [null, { debtId: 'x', name: 'A', payoffDate: '2027-03-19', totalInterest: -4 }] }));
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.debts, [{ debtId: null, name: 'A', payoffDate: '2027-03-01', totalInterest: 0 }]);
    const notArray = await api('POST', '/api/plan-history', entry({ debts: { debtId: 1 } }));
    assert.equal(notArray.status, 201);
    assert.deepEqual(notArray.body.debts, []);
});

test('migration 047 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
    const collect = async (fn) => {
        const stmts = [];
        await fn({ sql: (s) => stmts.push(s) });
        return stmts;
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cols = () => client.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'plan_history' AND column_name = 'debts'`
        );
        for (const s of await collect(up)) await client.query(s);
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
