import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { generateIcsFromDbRows } from '../src/calendarGenerator.js';
import { buildIcs, icsEscape, icsFold } from '../../src/calendarCore.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';

// #526: the browser's .ics download (src/calendarFeed.js) and the webcal feed
// (server/src/calendarGenerator.js) build their text with one module,
// src/calendarCore.js. The "client" side here is buildIcs fed the records the
// app holds (what the REST API returns); the server side reads the same rows
// straight from Postgres. They must agree byte for byte.

let server, baseUrl, cookies, userId, accountId;
const NOW = new Date(2026, 10, 24, 12, 0, 0);
const APP_URL = 'http://localhost';

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

async function create(path, body) {
    const res = await api('POST', path, body);
    assert.equal(res.status, 201, `${path} ${body.name}: ${JSON.stringify(res.body)}`);
    return res.body;
}

beforeEach(async () => {
    await resetDb();
    const user = await createTestUser();
    userId = user.id;
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    accountId = (await create('/api/accounts', { name: 'Checking; main, joint', type: 'checking', startingBalance: 0, interestRate: 0 })).id;
});

async function clientShapedState(extra = {}) {
    const get = async path => (await api('GET', path)).body;
    return {
        accounts: await get('/api/accounts'),
        bills: await get('/api/bills'),
        debts: await get('/api/debts'),
        recurringTemplates: await get('/api/recurring-templates'),
        incomes: await get('/api/incomes'),
        expenses: await get('/api/expenses'),
        showArchived: false,
        appUrl: APP_URL,
        now: NOW,
        ...extra,
    };
}

function unfold(ics) {
    return ics.replace(/\r\n[ \t]/g, '');
}

// Positive: client builder and server generator are byte-identical.
test('client builder and server generator produce byte-identical ICS', async () => {
    await create('/api/bills', { name: 'Rent, "main"; unit 4', amount: 1200, dueDay: 31, category: 'Housing', accountId });
    await create('/api/bills', { name: 'Water', amount: 40.5, dueDay: 15, category: 'Utilities' });
    await create('/api/debts', { name: 'Card', category: 'Credit Card', debtType: 'creditCard', accountBalance: 900, minimumPayment: 35, interestRate: 22, dueDate: 30, weekendRule: 'before', accountId });
    await create('/api/debts', { name: 'Old loan', category: 'Loan', debtType: 'personalLoan', accountBalance: 100, minimumPayment: 10, interestRate: 5, dueDate: 10, archived: true });
    await create('/api/debts', { name: 'Typed date', category: 'Loan', debtType: 'personalLoan', accountBalance: 100, minimumPayment: 10, interestRate: 5, nextPaymentDue: '2026-12-09' });
    await create('/api/recurring-templates', { name: 'Weekly', type: 'subscription', amount: 5, frequency: 'weekly', startDate: '2025-06-04', dayOfMonth: 1, accountId });
    await create('/api/recurring-templates', { name: 'Refund\nline two', type: 'reimbursement', amount: 20, frequency: 'monthly', dayOfMonth: 12, category: 'Back\\slash', accountId });
    await create('/api/recurring-templates', { name: 'Dated', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 5, startDate: '2026-01-01', amountChanges: [{ from: '2026-12-01', amount: 18 }] });
    await create('/api/incomes', { name: 'Biweekly', amount: 1000, frequency: 'biweekly', firstPayDate: '2025-01-03', accountId });
    await create('/api/incomes', { name: 'A long job name that forces the summary line well past the seventy-five octet fold limit', amount: 2500, frequency: 'monthly', firstPayDate: '2025-01-31', accountId });
    await create('/api/expenses', { name: 'Groceries', budgetAmount: 400, date: '2026-11-02', category: 'Food', accountId });
    await create('/api/expenses', { name: 'Trip', budgetAmount: 900, date: '2027-02-28', category: 'Travel' });

    for (const showArchived of [false, true]) {
        if (showArchived) await api('PUT', '/api/settings/showArchivedDebts', { value: true });
        const state = await clientShapedState({ showArchived });
        const clientIcs = buildIcs(state);
        const serverIcs = await generateIcsFromDbRows(userId, APP_URL, NOW);
        assert.equal(serverIcs, clientIcs, `showArchived=${showArchived}`);
    }

    const final = await generateIcsFromDbRows(userId, APP_URL, NOW);
    assert.ok((final.match(/BEGIN:VEVENT/g) || []).length > 100);
    assert.match(final, /SUMMARY:Bill - Rent\\, main\\; unit 4/);
    assert.match(unfold(final), /DESCRIPTION:Amount Due: \$35\.00\\nCategory: Credit Card\\nAccount: Checking\\; main\\, joint/);
    assert.match(final, /SUMMARY:Debt \(Archived\) - Old loan/);
    assert.match(final, /SUMMARY:Reimbursement - Refund/);
    assert.match(final, /UID:debt-\d+-20261209@myfinances/);
    assert.match(final, /SUMMARY:Payday - Biweekly/);
    for (const physical of final.split('\r\n')) assert.ok(physical.length <= 75, `unfolded line: ${physical}`);
    // The dated amount applies from December.
    assert.match(unfold(final), /UID:recurring-\d+-20261105@myfinances[^]*?Amount Due: \$15\.00/);
    assert.match(unfold(final), /UID:recurring-\d+-20261205@myfinances[^]*?Amount Due: \$18\.00/);
});

// Negative: items that must not appear.
test('paused, skipped, ended, paid and archived items are excluded from both builders', async () => {
    await create('/api/recurring-templates', { name: 'Still paused', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 12, paused: true, pauseUntil: '2099-01-01', accountId });
    await create('/api/recurring-templates', { name: 'Archived sub', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 13, archived: true, accountId });
    await create('/api/recurring-templates', { name: 'Ended sub', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 14, startDate: '2024-01-01', endDate: '2025-06-30', accountId });
    await create('/api/recurring-templates', { name: 'Paid month', type: 'subscription', amount: 9, frequency: 'monthly', dayOfMonth: 15, paidMonths: ['2026-11'], skippedMonths: ['2026-12'], accountId });
    await create('/api/incomes', { name: 'Ended job', amount: 1000, frequency: 'monthly', firstPayDate: '2024-01-05', endDate: '2025-03-31', accountId });
    await create('/api/debts', { name: 'Hidden archived', category: 'Loan', debtType: 'personalLoan', accountBalance: 100, minimumPayment: 10, interestRate: 5, dueDate: 10, archived: true });

    const clientIcs = buildIcs(await clientShapedState());
    const serverIcs = await generateIcsFromDbRows(userId, APP_URL, NOW);
    assert.equal(serverIcs, clientIcs);
    assert.doesNotMatch(serverIcs, /Still paused|Archived sub|Hidden archived/);
    assert.doesNotMatch(serverIcs, /Ended sub/);
    // The ended income has no payday after its end date (window starts Nov 2025).
    assert.doesNotMatch(serverIcs, /Payday - Ended job/);
    const paid = serverIcs.split('BEGIN:VEVENT').filter(b => b.includes('Subscription - Paid month'));
    assert.ok(paid.length > 0);
    assert.ok(!paid.some(b => /DTSTART;VALUE=DATE:202611/.test(b)), 'a paid month is omitted');
    assert.ok(!paid.some(b => /DTSTART;VALUE=DATE:202612/.test(b)), 'a skipped month is omitted');
});

test('empty data gives a valid empty VCALENDAR on both sides', async () => {
    const clientIcs = buildIcs({ now: NOW });
    const serverIcs = await generateIcsFromDbRows(userId, APP_URL, NOW);
    assert.equal(serverIcs, buildIcs(await clientShapedState({ accounts: [] })));
    assert.equal(clientIcs, [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MyFinances//MyFinances Calendar Feed//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:MyFinances', 'END:VCALENDAR', '',
    ].join('\r\n'));
    assert.equal(serverIcs, clientIcs);
});

test('malicious text cannot inject ICS properties', () => {
    const evil = 'x\r\nBEGIN:VEVENT\nATTENDEE:mailto:a@b.c;';
    const ics = buildIcs({
        now: NOW,
        bills: [{ id: 1, name: evil, amount: 5, dueDay: 1, category: evil }],
    });
    const lines = unfold(ics).split('\r\n');
    assert.equal(lines.filter(l => l === 'BEGIN:VEVENT').length, 25, 'one event per window month, none injected');
    assert.ok(!lines.some(l => l.startsWith('ATTENDEE')));
    assert.ok(lines.some(l => l.startsWith('SUMMARY:Bill - x\\nBEGIN:VEVENT\\nATTENDEE:mailto:a@b.c\\;')));
});

test('icsEscape and icsFold follow RFC 5545', () => {
    assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    assert.equal(icsEscape(null), '');
    assert.equal(icsFold('a'.repeat(75)), 'a'.repeat(75) + '\r\n');
    assert.equal(icsFold('a'.repeat(76)), 'a'.repeat(75) + '\r\n a\r\n');
    const folded = icsFold('b'.repeat(200)).split('\r\n').filter(Boolean);
    assert.deepEqual(folded.map(l => l.length), [75, 75, 52]);
});

test('the generator keeps no ICS helpers of its own', () => {
    const src = readFileSync(new URL('../src/calendarGenerator.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /function (icsEscape|icsFold|vevent|buildDesc|isoDateStr)\b/);
    assert.match(src, /from '\.\.\/\.\.\/src\/calendarCore\.js'/);
    const client = readFileSync(new URL('../../src/calendarFeed.js', import.meta.url), 'utf8');
    assert.doesNotMatch(client, /function (icsEscape|icsFold|vevent|buildDesc|isoDateStr)\b/);
    assert.match(client, /from '\.\/calendarCore\.js'/);
});
