import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { getRecurringOccurrencesInMonth } from '../../src/recurringOccurrences.js';
import { getIncomePaydaysInMonth, dateToISO } from '../../src/utils.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// #579 / part of #526: the webcal feed takes recurring occurrences and income
// paydays from the browser's own pure functions instead of server copies.

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

async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    assert.equal(res.status, 201);
    return res.json();
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    userId = user.id;
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await post('/api/accounts', { name: 'Checking', type: 'Checking', startingBalance: 0, interestRate: 0 })).id;
});

const compact = d => dateToISO(d).replace(/-/g, '');

function eventDates(ics, uidPrefix) {
    return [...ics.matchAll(new RegExp(`UID:${uidPrefix}-(\\d{8})@myfinances`, 'g'))].map(m => m[1]).sort();
}

// Every month of the feed's window (12 back, 12 ahead).
function windowMonths() {
    const now = new Date();
    const out = [];
    for (let delta = -12; delta <= 12; delta++) {
        const ref = new Date(now.getFullYear(), now.getMonth() + delta, 1);
        out.push([ref.getFullYear(), ref.getMonth()]);
    }
    return out;
}

test('the server no longer carries its own occurrence or payday engine', () => {
    const src = readFileSync(new URL('../src/calendarGenerator.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /function (getOccurrences|getPaydays|isEffectivelyPaused)\b/);
    assert.match(src, /from '\.\.\/\.\.\/src\/recurringOccurrences\.js'/);
});

test('recurring events in the feed are exactly the shared occurrence dates', async () => {
    const today = new Date();
    const past = dateToISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3));
    const future = dateToISO(new Date(today.getFullYear(), today.getMonth() + 2, 1));
    const templates = [
        { name: 'Weekly', type: 'subscription', amount: 5, frequency: 'weekly', startDate: '2025-06-04', dayOfMonth: 1, accountId },
        { name: 'Quarterly', type: 'subscription', amount: 50, frequency: 'quarterly', startDate: '2025-02-28', dayOfMonth: 31, weekendRule: 'before', accountId },
        { name: 'Resumed', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 12, paused: true, pauseUntil: past, accountId },
        { name: 'Still paused', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 12, paused: true, pauseUntil: future, accountId },
    ];
    const created = [];
    for (const t of templates) created.push(await post('/api/recurring-templates', t));

    const ics = await generateIcsFromDbRows(userId, null);
    for (const tmpl of created) {
        const expected = windowMonths()
            .flatMap(([y, m]) => getRecurringOccurrencesInMonth(tmpl, y, m))
            .map(compact).sort();
        assert.deepEqual(eventDates(ics, `recurring-${tmpl.id}`), expected, tmpl.name);
    }
    assert.ok(eventDates(ics, `recurring-${created[0].id}`).length > 50, 'weekly occurs in every month');
    assert.ok(eventDates(ics, `recurring-${created[2].id}`).length > 0, 'a pause that ended shows events');
    assert.deepEqual(eventDates(ics, `recurring-${created[3].id}`), [], 'an active pause shows none');
});

test('payday events in the feed are exactly the shared payday dates', async () => {
    const incomes = [
        await post('/api/incomes', { name: 'Biweekly', amount: 1000, frequency: 'biweekly', firstPayDate: '2025-01-03', accountId }),
        await post('/api/incomes', { name: 'Twice', amount: 1000, frequency: 'twice_monthly', firstPayDate: '2025-03-15', accountId }),
        await post('/api/incomes', { name: 'Monthly', amount: 1000, frequency: 'monthly', firstPayDate: '2025-01-31', accountId }),
    ];
    const ics = await generateIcsFromDbRows(userId, null);
    for (const inc of incomes) {
        const expected = windowMonths()
            .flatMap(([y, m]) => getIncomePaydaysInMonth(inc, y, m))
            .map(compact).sort();
        assert.ok(expected.length > 0);
        assert.deepEqual(eventDates(ics, `income-${inc.id}`), expected, inc.name);
    }
});
