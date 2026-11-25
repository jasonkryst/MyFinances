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
    assert.deepEqual(body.ledgerSettings, { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc', clearedFilter: 'all', categoryFilter: 'all', pageSize: 25 });
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

async function patchLedger(ledgerSettings) {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ ledgerSettings })
    });
    assert.equal(res.status, 200);
    return (await res.json()).ledgerSettings;
}

test('PATCH ledgerSettings round-trips categoryFilter and pageSize (#571)', async () => {
    const sent = { accountFilter: '7', dateRange: 'next30', sortKey: 'amount', sortDir: 'asc',
        clearedFilter: 'cleared', categoryFilter: 'Housing', pageSize: 50 };
    assert.deepEqual(await patchLedger(sent), sent);
    const got = await (await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } })).json();
    assert.deepEqual(got.ledgerSettings, sent);
});

test('PATCH ledgerSettings sanitizes an invalid pageSize and an oversized category (#571)', async () => {
    for (const bad of [7, 0, -25, 'abc', null, 1e9, 25.5]) {
        assert.equal((await patchLedger({ pageSize: bad })).pageSize, 25, `pageSize ${bad}`);
    }
    const out = await patchLedger({ pageSize: 100, categoryFilter: 'x'.repeat(500) });
    assert.equal(out.pageSize, 100);
    assert.equal(out.categoryFilter.length, 40);
    assert.equal((await patchLedger({ categoryFilter: '   ' })).categoryFilter, 'all');
    assert.equal((await patchLedger({})).categoryFilter, 'all');
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

test('PATCH accepts and persists retirementTargetDate', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ retirementTargetDate: '2050-01-01' })
    });
    const res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    const body = await res.json();
    assert.equal(body.retirementTargetDate, '2050-01-01');
});

test('PATCH persists homePurchasePlan and clears it with null', async () => {
    let res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(),
        body: JSON.stringify({ homePurchasePlan: { targetHomePrice: 400000, targetDownPaymentPct: 10, notes: 'hi' } })
    });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    let body = await res.json();
    assert.equal(body.homePurchasePlan.targetHomePrice, 400000);
    assert.equal(body.homePurchasePlan.targetDownPaymentPct, 10);
    assert.equal(body.homePurchasePlan.notes, 'hi');

    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ homePurchasePlan: null })
    });
    res = await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } });
    body = await res.json();
    assert.equal(body.homePurchasePlan, null);
});

test('PATCH sanitizes invalid homePurchasePlan payloads to null', async () => {
    for (const bad of ['a string', [1, 2], { targetHomePrice: -5 }, { targetHomePrice: 'abc' }, {}, 42]) {
        await fetch(`${baseUrl}/api/plan-settings`, {
            method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ homePurchasePlan: { targetHomePrice: 1000 } })
        });
        const res = await fetch(`${baseUrl}/api/plan-settings`, {
            method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ homePurchasePlan: bad })
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).homePurchasePlan, null, JSON.stringify(bad));
    }
});

test('PATCH truncates oversized homePurchasePlan notes and clamps negatives', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(),
        body: JSON.stringify({ homePurchasePlan: { targetHomePrice: 1000, notes: '<script>alert(1)</script>' + 'x'.repeat(5000), currentSavings: -50 } })
    });
    const plan = (await res.json()).homePurchasePlan;
    assert.ok(plan.notes.length <= 500);
    assert.equal(plan.currentSavings, 0);
});

test('PATCH without homePurchasePlan leaves an existing plan untouched', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ homePurchasePlan: { targetHomePrice: 2000 } })
    });
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ strategy: 'avalanche' })
    });
    assert.equal((await res.json()).homePurchasePlan.targetHomePrice, 2000);
});

test('PATCH persists budgetCategories and GET defaults to {}', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(),
        body: JSON.stringify({ budgetCategories: { Housing: { mode: 'fixed', amount: 2000 }, Food: { mode: 'derived' } } })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.budgetCategories.Housing, { mode: 'fixed', amount: 2000 });
    assert.equal(body.budgetCategories.Food.mode, 'derived');
});

test('PATCH sanitizes budgetCategories server-side', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(),
        body: JSON.stringify({ budgetCategories: {
            Good: { mode: 'fixed', amount: 50 },
            Negative: { mode: 'fixed', amount: -5 },
            BadMode: { mode: 'weird', amount: 5 },
            ['x'.repeat(300)]: { mode: 'fixed', amount: 1 }
        } })
    });
    const cats = (await res.json()).budgetCategories;
    assert.equal(cats.Good.amount, 50);
    assert.equal(cats.Negative, undefined);
    assert.equal(cats.BadMode, undefined);
    assert.ok(cats['x'.repeat(40)]);
    assert.equal(cats['x'.repeat(300)], undefined);
});

test('PATCH with a non-object budgetCategories clears to {}, omitting it leaves it untouched', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ budgetCategories: { Housing: { mode: 'fixed', amount: 10 } } })
    });
    let res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ strategy: 'avalanche' })
    });
    assert.equal((await res.json()).budgetCategories.Housing.amount, 10);
    res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ budgetCategories: 'nope' })
    });
    assert.deepEqual((await res.json()).budgetCategories, {});
});

// #587: in-progress reconciliations live on the server.
async function patchDrafts(reconDrafts) {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ reconDrafts })
    });
    assert.equal(res.status, 200);
    return (await res.json()).reconDrafts;
}

test('GET returns empty reconDrafts by default (#587)', async () => {
    const body = await (await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } })).json();
    assert.deepEqual(body.reconDrafts, {});
});

test('PATCH reconDrafts round-trips a draft and replaces the whole map (#587)', async () => {
    const draft = { statementBalance: '1234.56', statementStartDate: '2026-06-01', statementEndDate: '2026-06-30',
        note: 'Half way', clearedTxIds: ['income|3|7|2026-06-05', 'debt|1|7|2026-06-10'], savedAt: '2026-06-15T00:00:00.000Z' };
    assert.deepEqual(await patchDrafts({ 7: draft }), { 7: draft });
    const got = await (await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } })).json();
    assert.deepEqual(got.reconDrafts, { 7: draft });
    // The map is replaced, so removing an account's draft sends the rest.
    assert.deepEqual(await patchDrafts({}), {});
});

test('PATCH reconDrafts sanitizes keys, values and caps (#587)', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => `k|${i}|7|2026-06-01`);
    const got = await patchDrafts({
        7: { statementBalance: 12.5, note: '<b>x</b>', clearedTxIds: [...many, 5, 'k|0|7|2026-06-01'], savedAt: 'nope',
             statementStartDate: 'garbage' },
        abc: { statementBalance: '1' },
        '-3': { statementBalance: '1' },
        __proto__: { statementBalance: '1' },
        9: 'not an object',
        10: [1, 2],
    });
    assert.deepEqual(Object.keys(got), ['7']);
    assert.equal(got[7].statementBalance, '12.5');
    assert.equal(got[7].note, 'bx/b');
    assert.equal(got[7].clearedTxIds.length, 2000);
    assert.equal(got[7].savedAt, null);
    assert.equal(got[7].statementStartDate, null);
});

test('PATCH reconDrafts with a non-object clears them (#587)', async () => {
    await patchDrafts({ 7: { statementBalance: '1', clearedTxIds: [] } });
    for (const bad of [null, 'x', 5, []]) {
        assert.deepEqual(await patchDrafts(bad), {});
    }
});

test('PATCH reconDrafts leaves other plan fields alone and writes no change-log row (#587)', async () => {
    await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(), body: JSON.stringify({ strategy: 'snowball' })
    });
    const before = (await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    await patchDrafts({ 7: { statementBalance: '1', clearedTxIds: [] } });
    const after = (await pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    assert.equal(after, before);
    const got = await (await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } })).json();
    assert.equal(got.strategy, 'snowball');
});

test('PATCH round-trips budget rollover fields and drops an invalid rollover (#687)', async () => {
    const res = await fetch(`${baseUrl}/api/plan-settings`, {
        method: 'PATCH', headers: csrfHeaders(),
        body: JSON.stringify({ budgetCategories: {
            Food: { mode: 'fixed', amount: 300, rollover: 'both', rolloverStart: '2026-05' },
            Rent: { mode: 'derived', rollover: 'overspend', rolloverStart: '2026-01' },
            Bad: { mode: 'fixed', amount: 10, rollover: 'sideways', rolloverStart: '2026-01' },
            NoStart: { mode: 'fixed', amount: 10, rollover: 'both' },
            BadMonth: { mode: 'fixed', amount: 10, rollover: 'both', rolloverStart: '2026-13' }
        } })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.budgetCategories.Food, { mode: 'fixed', amount: 300, rollover: 'both', rolloverStart: '2026-05' });
    assert.deepEqual(body.budgetCategories.Rent, { mode: 'derived', amount: 0, rollover: 'overspend', rolloverStart: '2026-01' });
    for (const name of ['Bad', 'NoStart', 'BadMonth']) {
        assert.deepEqual(body.budgetCategories[name], { mode: 'fixed', amount: 10 });
    }
    const again = await (await fetch(`${baseUrl}/api/plan-settings`, { headers: { Cookie: cookies } })).json();
    assert.deepEqual(again.budgetCategories.Food, body.budgetCategories.Food);
});
