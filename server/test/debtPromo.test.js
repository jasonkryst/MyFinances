import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { checkNotificationsForUser } from '../src/jobs/notifications.js';
import { up, down } from '../migrations/1755600000046_add-debt-promo-apr.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #681: promotional APR on debts.

let server, baseUrl, cookies, userId, accountId;
const quietLog = { info() {}, warn() {}, error() {} };

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
    accountId = (await api('POST', '/api/accounts', { name: 'Checking', type: 'checking', startingBalance: 5000, interestRate: 0 })).body.id;
});

const debt = (extra) => ({ name: 'Store Card', category: 'Credit Card', debtType: 'creditCard', accountBalance: 1200, minimumPayment: 40, interestRate: 26.99, dueDate: 28, accountId, ...extra });
const PROMO = { promoRate: 0, promoEndDate: '2027-06-30', deferredInterest: true, deferredInterestAccrued: 35.5 };

test('POST round-trips the promo fields and GET returns them', async () => {
    const created = await api('POST', '/api/debts', debt(PROMO));
    assert.equal(created.status, 201);
    assert.deepEqual(
        [created.body.promoRate, created.body.promoEndDate, created.body.deferredInterest, created.body.deferredInterestAccrued],
        [0, '2027-06-30', true, 35.5]
    );
    const list = await api('GET', '/api/debts');
    const row = list.body.find(d => d.id === created.body.id);
    assert.deepEqual([row.promoRate, row.promoEndDate, row.deferredInterest, row.deferredInterestAccrued], [0, '2027-06-30', true, 35.5]);
});

test('an old-shape POST gets no promo', async () => {
    const created = await api('POST', '/api/debts', debt());
    assert.equal(created.status, 201);
    assert.deepEqual(
        [created.body.promoRate, created.body.promoEndDate, created.body.deferredInterest, created.body.deferredInterestAccrued],
        [null, null, false, 0]
    );
});

test('a half promo is cleared by the sanitizer', async () => {
    const created = await api('POST', '/api/debts', debt({ promoRate: 0, deferredInterest: true, deferredInterestAccrued: 10 }));
    assert.equal(created.status, 201);
    assert.deepEqual(
        [created.body.promoRate, created.body.promoEndDate, created.body.deferredInterest, created.body.deferredInterestAccrued],
        [null, null, false, 0]
    );
});

test('PATCH sets, keeps when omitted, and clears the promo', async () => {
    const id = (await api('POST', '/api/debts', debt())).body.id;
    let patched = await api('PATCH', `/api/debts/${id}`, { promoRate: 1.9, promoEndDate: '2027-03-31' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.promoRate, 1.9);
    assert.equal(patched.body.promoEndDate, '2027-03-31');
    patched = await api('PATCH', `/api/debts/${id}`, { minimumPayment: 45 });
    assert.equal(patched.body.promoRate, 1.9);
    patched = await api('PATCH', `/api/debts/${id}`, { promoRate: null, promoEndDate: null });
    assert.equal(patched.body.promoRate, null);
    assert.equal(patched.body.promoEndDate, null);
});

test('migration 046 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
    const collect = async (fn) => {
        const stmts = [];
        await fn({ sql: (s) => stmts.push(s) });
        return stmts;
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cols = () => client.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'debts'
             AND column_name IN ('promo_rate', 'promo_end_date', 'deferred_interest', 'deferred_interest_accrued')`
        );
        for (const s of await collect(up)) await client.query(s); // already applied
        assert.equal((await cols()).rowCount, 4);
        for (const s of await collect(down)) await client.query(s);
        assert.equal((await cols()).rowCount, 0);
        for (const s of await collect(down)) await client.query(s);
        for (const s of await collect(up)) await client.query(s);
        assert.equal((await cols()).rowCount, 4);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

test('the notifications job raises one promoEnding alert within 60 days', async () => {
    const now = new Date(2026, 10, 15, 12);
    await api('POST', '/api/debts', debt({ promoRate: 0, promoEndDate: '2026-12-31' }));
    await api('POST', '/api/debts', debt({ name: 'Far Card', promoRate: 0, promoEndDate: '2027-06-30' }));
    await checkNotificationsForUser(userId, now, quietLog);
    await checkNotificationsForUser(userId, now, quietLog); // deduped
    const { rows } = await pool.query("SELECT dedupe_key, params FROM notifications WHERE user_id = $1 AND type = 'promoEnding'", [userId]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].dedupe_key, /^promoEnding\|\d+\|2026-12-31$/);
    assert.equal(rows[0].params.name, 'Store Card');
    assert.equal(rows[0].params.daysUntil, 46);
    const listed = await api('GET', '/api/notifications?type=promo&status=all');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.notifications.map(n => n.type), ['promoEnding']);
});

test('notifyPromoEnding false turns the alert off', async () => {
    const put = await api('PUT', '/api/settings/notifyPromoEnding', { value: false });
    assert.ok(put.status < 300);
    await api('POST', '/api/debts', debt({ promoRate: 0, promoEndDate: '2026-12-31' }));
    await checkNotificationsForUser(userId, new Date(2026, 10, 15, 12), quietLog);
    const { rowCount } = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'promoEnding'", [userId]);
    assert.equal(rowCount, 0);
});

test('the calendar feed is unaffected by a promo', async () => {
    const plain = (await api('POST', '/api/debts', debt({ name: 'Plain' }))).body.id;
    const promo = (await api('POST', '/api/debts', debt({ name: 'Promo', ...PROMO }))).body.id;
    const ics = await generateIcsFromDbRows(userId, 'http://localhost');
    const dates = id => [...ics.matchAll(new RegExp(`UID:debt-${id}-(\\d{8})@myfinances`, 'g'))].map(m => m[1]);
    assert.ok(dates(plain).length > 0);
    assert.deepEqual(dates(promo), dates(plain));
});
