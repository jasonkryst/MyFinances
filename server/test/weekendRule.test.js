import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { applyWeekendRule } from '../../src/weekendRule.js';
import { up, down } from '../migrations/1755600000036_add-weekend-rule.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #165: weekendRule on recurring templates and debts.

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

const RESOURCES = [
    {
        label: 'recurring template',
        path: '/api/recurring-templates',
        table: 'recurring_templates',
        payload: (extra) => ({ name: 'Rent', type: 'subscription', amount: 900, frequency: 'monthly', dayOfMonth: 14, category: 'Housing', accountId, ...extra })
    },
    {
        label: 'debt',
        path: '/api/debts',
        table: 'debts',
        payload: (extra) => ({ name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, dueDate: 14, accountId, ...extra })
    }
];

for (const r of RESOURCES) {
    test(`${r.label}: POST round-trips weekendRule and GET returns it`, async () => {
        for (const rule of ['before', 'after', 'none']) {
            const created = await api('POST', r.path, r.payload({ weekendRule: rule }));
            assert.equal(created.status, 201);
            assert.equal(created.body.weekendRule, rule);
            const list = await api('GET', r.path);
            assert.equal(list.body.find(x => x.id === created.body.id).weekendRule, rule);
        }
    });

    test(`${r.label}: an old-shape POST (no weekendRule) gets none`, async () => {
        const created = await api('POST', r.path, r.payload());
        assert.equal(created.status, 201);
        assert.equal(created.body.weekendRule, 'none');
    });

    test(`${r.label}: PATCH changes the rule and leaves it alone when omitted`, async () => {
        const created = await api('POST', r.path, r.payload({ weekendRule: 'before' }));
        const id = created.body.id;
        const patched = await api('PATCH', `${r.path}/${id}`, { weekendRule: 'after' });
        assert.equal(patched.status, 200);
        assert.equal(patched.body.weekendRule, 'after');
        const other = await api('PATCH', `${r.path}/${id}`, { name: 'Renamed' });
        assert.equal(other.status, 200);
        assert.equal(other.body.weekendRule, 'after');
    });

    test(`${r.label}: an invalid value is coerced to none by the sanitizer`, async () => {
        const created = await api('POST', r.path, r.payload({ weekendRule: 'sideways' }));
        assert.equal(created.status, 201);
        assert.equal(created.body.weekendRule, 'none');
        const ok = await api('POST', r.path, r.payload({ weekendRule: 'after' }));
        const patched = await api('PATCH', `${r.path}/${ok.body.id}`, { weekendRule: 'bogus' });
        assert.equal(patched.status, 200);
        assert.equal(patched.body.weekendRule, 'none');
    });

    test(`${r.label}: the database CHECK rejects an invalid value written directly`, async () => {
        const created = await api('POST', r.path, r.payload());
        await assert.rejects(
            () => pool.query(`UPDATE ${r.table} SET weekend_rule = 'sideways' WHERE id = $1`, [created.body.id]),
            /check constraint/i
        );
    });
}

test('migration 036 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
    const collect = async (fn) => {
        const stmts = [];
        await fn({ sql: (s) => stmts.push(s) });
        return stmts;
    };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const s of await collect(up)) await client.query(s); // second run: already applied
        const cols = () => client.query(
            `SELECT table_name FROM information_schema.columns
             WHERE column_name = 'weekend_rule' AND table_name IN ('recurring_templates', 'debts')`
        );
        assert.equal((await cols()).rowCount, 2);
        for (const s of await collect(down)) await client.query(s);
        assert.equal((await cols()).rowCount, 0);
        for (const s of await collect(down)) await client.query(s); // down is idempotent too
        for (const s of await collect(up)) await client.query(s);
        assert.equal((await cols()).rowCount, 2);
        const checks = await client.query(
            `SELECT conname FROM pg_constraint WHERE conname IN ('recurring_templates_weekend_rule_check', 'debts_weekend_rule_check')`
        );
        assert.equal(checks.rowCount, 2);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

// ─── /calendar.ics gives the shifted date ───────────────────────────────────

function expectedDates(day, rule) {
    const out = [];
    const now = new Date();
    for (let delta = -12; delta <= 12; delta++) {
        const ref = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        const dim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
        const d = applyWeekendRule(new Date(ref.getFullYear(), ref.getMonth(), Math.min(day, dim), 12), rule);
        out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
    }
    return out;
}

function feedDates(ics, prefix, id) {
    const re = new RegExp(`UID:${prefix}-${id}-(\\d{8})@myfinances`, 'g');
    return [...ics.matchAll(re)].map(m => m[1]);
}

test('the webcal feed shifts recurring-template events per weekendRule', async () => {
    const before = (await api('POST', '/api/recurring-templates', { name: 'Rent B', type: 'subscription', amount: 900, frequency: 'monthly', dayOfMonth: 14, category: 'Housing', accountId, weekendRule: 'before' })).body.id;
    const after = (await api('POST', '/api/recurring-templates', { name: 'Rent A', type: 'subscription', amount: 900, frequency: 'monthly', dayOfMonth: 14, category: 'Housing', accountId, weekendRule: 'after' })).body.id;
    const none = (await api('POST', '/api/recurring-templates', { name: 'Rent N', type: 'subscription', amount: 900, frequency: 'monthly', dayOfMonth: 14, category: 'Housing', accountId })).body.id;
    const ics = await generateIcsFromDbRows(userId, 'http://localhost');
    assert.deepEqual(feedDates(ics, 'recurring', before), expectedDates(14, 'before'));
    assert.deepEqual(feedDates(ics, 'recurring', after), expectedDates(14, 'after'));
    assert.deepEqual(feedDates(ics, 'recurring', none), expectedDates(14, 'none'));
    // The window must contain a weekend 14th, or this test proves nothing.
    assert.notDeepEqual(expectedDates(14, 'before'), expectedDates(14, 'none'));
    assert.notDeepEqual(feedDates(ics, 'recurring', before), feedDates(ics, 'recurring', none));
});

test('the webcal feed shifts debt due-date events per weekendRule', async () => {
    const before = (await api('POST', '/api/debts', { name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, dueDate: 14, weekendRule: 'before', accountId })).body.id;
    const after = (await api('POST', '/api/debts', { name: 'Amex', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, dueDate: 14, weekendRule: 'after', accountId })).body.id;
    const none = (await api('POST', '/api/debts', { name: 'Disc', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3000, minimumPayment: 75, interestRate: 19.99, dueDate: 14, accountId })).body.id;
    const ics = await generateIcsFromDbRows(userId, 'http://localhost');
    assert.deepEqual(feedDates(ics, 'debt', before), expectedDates(14, 'before'));
    assert.deepEqual(feedDates(ics, 'debt', after), expectedDates(14, 'after'));
    assert.deepEqual(feedDates(ics, 'debt', none), expectedDates(14, 'none'));
});
