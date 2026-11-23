import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { pool } from '../src/db.js';
import { up, down } from '../migrations/1755600000044_add-amount-changes.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// Issue #678: effective-dated amounts (`amountChanges`) on incomes and
// recurring templates.

let server, baseUrl, cookies, userId, accountId, otherAccountId;

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
    otherAccountId = (await api('POST', '/api/accounts', { name: 'Savings', type: 'savings', startingBalance: 0, interestRate: 0 })).body.id;
});

const CHANGES = [{ from: '2027-01-01', amount: 18 }, { from: '2027-07-01', amount: 20 }];

const RESOURCES = [
    {
        label: 'income',
        path: '/api/incomes',
        payload: (extra) => ({ name: 'Pay', amount: 15, firstPayDate: '2026-01-02', frequency: 'biweekly', accountId, ...extra })
    },
    {
        label: 'recurring template',
        path: '/api/recurring-templates',
        payload: (extra) => ({ name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 5, category: 'Subscriptions', accountId, ...extra })
    }
];

for (const r of RESOURCES) {
    test(`${r.label}: POST round-trips amountChanges and GET returns it`, async () => {
        const created = await api('POST', r.path, r.payload({ amountChanges: CHANGES }));
        assert.equal(created.status, 201);
        assert.deepEqual(created.body.amountChanges, CHANGES);
        const list = await api('GET', r.path);
        assert.deepEqual(list.body.find(x => x.id === created.body.id).amountChanges, CHANGES);
    });

    test(`${r.label}: a record without amountChanges gets an empty list`, async () => {
        const created = await api('POST', r.path, r.payload({}));
        assert.equal(created.status, 201);
        assert.deepEqual(created.body.amountChanges, []);
    });

    test(`${r.label}: PATCH replaces the list and sanitizes it`, async () => {
        const created = await api('POST', r.path, r.payload({}));
        const patched = await api('PATCH', `${r.path}/${created.body.id}`, {
            amountChanges: [{ from: '2027-07-01', amount: 20 }, { from: 'bad', amount: 1 }, { from: '2027-01-01', amount: 18 }]
        });
        assert.equal(patched.status, 200);
        assert.deepEqual(patched.body.amountChanges, CHANGES);
    });
}

test('a transfer template PATCH adding a $0 change is rejected, an unrelated PATCH still passes', async () => {
    const created = await api('POST', '/api/recurring-templates', {
        name: 'To savings', type: 'transfer', amount: 100, frequency: 'monthly', dayOfMonth: 1,
        category: 'Transfer', accountId, targetAccountId: otherAccountId
    });
    assert.equal(created.status, 201);
    const bad = await api('PATCH', `/api/recurring-templates/${created.body.id}`, { amountChanges: [{ from: '2027-01-01', amount: 0 }] });
    assert.equal(bad.status, 400);
    const ok = await api('PATCH', `/api/recurring-templates/${created.body.id}`, { name: 'To savings (renamed)' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.amountChanges, []);
});

test('migration 044 is idempotent and its down() reverses it (inside a rolled-back transaction)', async () => {
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
             WHERE column_name = 'amount_changes' AND table_name IN ('incomes', 'recurring_templates')`
        );
        assert.equal((await cols()).rowCount, 2);
        for (const s of await collect(down)) await client.query(s);
        assert.equal((await cols()).rowCount, 0);
        for (const s of await collect(down)) await client.query(s); // down is idempotent too
        for (const s of await collect(up)) await client.query(s);
        assert.equal((await cols()).rowCount, 2);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

// The feed describes each event with the amount in effect on its date.
function iso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function eventDescription(ics, uidPrefix) {
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    const block = unfolded.split('BEGIN:VEVENT').find(b => b.includes(`UID:${uidPrefix}`));
    assert.ok(block, `no event ${uidPrefix}`);
    return block.match(/DESCRIPTION:([^\r\n]*)/)[1];
}

test('the webcal feed uses the dated amount for recurring and payday events', async () => {
    const now = new Date();
    const thisMonth5 = new Date(now.getFullYear(), now.getMonth(), 5);
    const nextMonth1 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth5 = new Date(now.getFullYear(), now.getMonth() + 1, 5);
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const changes = [{ from: iso(nextMonth1), amount: 18 }];
    const tmpl = await api('POST', '/api/recurring-templates', {
        name: 'Netflix', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 5,
        category: 'Subscriptions', accountId, startDate: iso(start), amountChanges: changes
    });
    const inc = await api('POST', '/api/incomes', {
        name: 'Pay', amount: 1000, firstPayDate: iso(new Date(start.getFullYear(), start.getMonth(), 5)),
        frequency: 'monthly', accountId, amountChanges: [{ from: iso(nextMonth1), amount: 1200 }]
    });
    const ics = await generateIcsFromDbRows(userId, baseUrl);
    const ymd = d => iso(d).replace(/-/g, '');
    assert.match(eventDescription(ics, `recurring-${tmpl.body.id}-${ymd(thisMonth5)}`), /Amount Due: \$15\.00/);
    assert.match(eventDescription(ics, `recurring-${tmpl.body.id}-${ymd(nextMonth5)}`), /Amount Due: \$18\.00/);
    assert.match(eventDescription(ics, `income-${inc.body.id}-${ymd(thisMonth5)}`), /Amount: \$1000\.00/);
    assert.match(eventDescription(ics, `income-${inc.body.id}-${ymd(nextMonth5)}`), /Amount: \$1200\.00/);
});
