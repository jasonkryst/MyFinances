import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import {
    jobsEnabled, claimRun, runJob, runDueJobs, startJobScheduler, MAX_ATTEMPTS, STALE_RUN_MINUTES,
} from '../src/jobs/runner.js';
import { JOBS } from '../src/jobs/index.js';
import { monthPeriodKey, hourPeriodKey } from '../src/jobs/periods.js';
import { pruneSessionsJob, JOB_RUN_RETENTION_DAYS } from '../src/jobs/pruneSessions.js';
import { netWorthSnapshotJob, captureSnapshotForUser, insertSnapshot } from '../src/jobs/netWorthSnapshot.js';
import { loadUserState, USER_STATE_COLLECTIONS } from '../src/jobs/loadUserState.js';
import { buildNetWorthSnapshot } from '../../src/netWorthCore.js';

// Issue #579 (job runner, monthly net-worth snapshot) and #536 (session pruning).

let server, baseUrl;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

beforeEach(async () => {
    await resetDb();
    await pool.query('TRUNCATE job_runs RESTART IDENTITY');
});

const quietLog = { log() {}, error() {} };

function fakeJob(name, run, periodKey = () => 'P1') {
    return { name, periodKey, run };
}

async function jobRow(name, period) {
    const { rows } = await pool.query('SELECT * FROM job_runs WHERE job_name = $1 AND period_key = $2', [name, period]);
    return rows[0];
}

// ─── JOBS_ENABLED ────────────────────────────────────────────────────────────

test('jobs are on by default and off only for false/0/no/off', () => {
    assert.equal(jobsEnabled({}), true);
    assert.equal(jobsEnabled({ JOBS_ENABLED: '' }), true);
    assert.equal(jobsEnabled({ JOBS_ENABLED: 'true' }), true);
    assert.equal(jobsEnabled({ JOBS_ENABLED: 'yes' }), true);
    for (const off of ['false', 'FALSE', ' False ', '0', 'no', 'off']) {
        assert.equal(jobsEnabled({ JOBS_ENABLED: off }), false, off);
    }
});

test('JOBS_ENABLED=false starts no scheduler and runs nothing', async () => {
    let ran = 0;
    const handle = startJobScheduler({
        jobs: [fakeJob('never', async () => { ran++; })],
        env: { JOBS_ENABLED: 'false' }, initialDelayMs: 1, intervalMs: 5, log: quietLog,
    });
    assert.equal(handle, null);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(ran, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM job_runs')).rows[0].n, 0);
});

test('an enabled scheduler runs its jobs once per period and stops', async () => {
    let ran = 0;
    const handle = startJobScheduler({
        jobs: [fakeJob('tick', async () => { ran++; })],
        env: {}, initialDelayMs: 1, intervalMs: 10, log: quietLog,
    });
    assert.ok(handle);
    await new Promise(r => setTimeout(r, 120));
    handle.stop();
    assert.equal(ran, 1, 'several ticks in one period run the job once');
    assert.equal((await jobRow('tick', 'P1')).status, 'succeeded');
});

test('the scheduler is started only from index.js main(), never by createApp()', () => {
    const indexSrc = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    const appSrc = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    assert.match(indexSrc, /startJobScheduler\(\{ jobs: JOBS \}\)/);
    assert.doesNotMatch(appSrc, /jobs\//);
});

test('the registry holds the snapshot, notifications and pruning jobs with distinct names', () => {
    const names = JOBS.map(j => j.name);
    assert.deepEqual([...names].sort(), ['net-worth-snapshot', 'notifications', 'prune-sessions']);
    for (const job of JOBS) {
        assert.equal(typeof job.periodKey, 'function');
        assert.equal(typeof job.run, 'function');
    }
});

test('period keys use local time: month YYYY-MM, hour YYYY-MM-DDTHH', () => {
    const d = new Date(2026, 0, 5, 7, 30);
    assert.equal(monthPeriodKey(d), '2026-01');
    assert.equal(hourPeriodKey(d), '2026-01-05T07');
    assert.notEqual(hourPeriodKey(new Date(2026, 0, 5, 8)), hourPeriodKey(d));
});

// ─── Claim-once semantics ────────────────────────────────────────────────────

test('a job runs once per period: a second run in the same period is a no-op', async () => {
    let ran = 0;
    const job = fakeJob('once', async () => { ran++; return { ok: true }; });
    const first = await runJob(job, new Date(), quietLog);
    const second = await runJob(job, new Date(), quietLog);
    assert.equal(first.status, 'succeeded');
    assert.equal(second.status, 'skipped');
    assert.equal(ran, 1);
    const row = await jobRow('once', 'P1');
    assert.equal(row.status, 'succeeded');
    assert.deepEqual(row.result, { ok: true });
    assert.ok(row.finished_at);
});

test('a new period runs again', async () => {
    let ran = 0;
    let period = 'A';
    const job = fakeJob('periodic', async () => { ran++; }, () => period);
    await runJob(job, new Date(), quietLog);
    period = 'B';
    await runJob(job, new Date(), quietLog);
    assert.equal(ran, 2);
});

test('concurrent claims for one period have exactly one winner', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => claimRun('race', '2026-11')));
    assert.equal(ids.filter(id => id !== null).length, 1);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM job_runs WHERE job_name = 'race'");
    assert.equal(rows[0].n, 1);
});

test('concurrent runJob calls (two processes) run the job body once', async () => {
    let ran = 0;
    const job = fakeJob('parallel', async () => { ran++; await new Promise(r => setTimeout(r, 30)); });
    const outcomes = await Promise.all([runJob(job, new Date(), quietLog), runJob(job, new Date(), quietLog)]);
    assert.equal(ran, 1);
    assert.deepEqual(outcomes.map(o => o.status).sort(), ['skipped', 'succeeded']);
});

// ─── Failures ────────────────────────────────────────────────────────────────

test('a failing job is recorded, does not throw, and is retried on the next tick', async () => {
    let calls = 0;
    const job = fakeJob('flaky', async () => {
        calls++;
        if (calls === 1) throw new Error('boom');
        return { done: true };
    });
    const first = await runJob(job, new Date(), quietLog);
    assert.equal(first.status, 'failed');
    let row = await jobRow('flaky', 'P1');
    assert.equal(row.status, 'failed');
    assert.match(row.error, /boom/);
    assert.ok(row.finished_at);

    const second = await runJob(job, new Date(), quietLog);
    assert.equal(second.status, 'succeeded');
    row = await jobRow('flaky', 'P1');
    assert.equal(row.status, 'succeeded');
    assert.equal(row.attempts, 2);
    assert.equal(row.error, null);
});

test(`a period that keeps failing stops retrying after ${MAX_ATTEMPTS} attempts`, async () => {
    let calls = 0;
    const job = fakeJob('broken', async () => { calls++; throw new Error('always'); });
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await runJob(job, new Date(), quietLog);
    assert.equal(calls, MAX_ATTEMPTS);
    const row = await jobRow('broken', 'P1');
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, MAX_ATTEMPTS);
});

test('a periodKey() that throws is reported as a failure, not an exception', async () => {
    const job = { name: 'badkey', periodKey() { throw new Error('no key'); }, async run() {} };
    const out = await runJob(job, new Date(), quietLog);
    assert.equal(out.status, 'failed');
});

test('runDueJobs runs every job even when one fails', async () => {
    let okRan = 0;
    const outcomes = await runDueJobs([
        fakeJob('fails', async () => { throw new Error('x'); }),
        fakeJob('works', async () => { okRan++; }),
    ], new Date(), quietLog);
    assert.equal(outcomes.fails.status, 'failed');
    assert.equal(outcomes.works.status, 'succeeded');
    assert.equal(okRan, 1);
});

test('a run still "running" is reclaimed only once it is stale', async () => {
    assert.ok(await claimRun('stuck', 'P1'));
    assert.equal(await claimRun('stuck', 'P1'), null, 'a fresh running claim is respected');
    await pool.query(
        `UPDATE job_runs SET started_at = now() - make_interval(mins => $1) WHERE job_name = 'stuck'`,
        [STALE_RUN_MINUTES + 1]
    );
    assert.ok(await claimRun('stuck', 'P1'), 'a stale running claim (dead process) is taken over');
});

// ─── #536: session pruning ───────────────────────────────────────────────────

test('expired sessions are pruned without a request presenting them; live ones remain', async () => {
    const user = await createTestUser();
    await pool.query(
        `INSERT INTO sessions (id, user_id, expires_at) VALUES
            ('expired-1', $1, now() - interval '1 day'),
            ('expired-2', $1, now() - interval '1 second'),
            ('live-1', $1, now() + interval '1 day')`,
        [user.id]
    );
    const out = await runJob(pruneSessionsJob, new Date(), quietLog);
    assert.equal(out.status, 'succeeded');
    assert.equal(out.result.sessionsDeleted, 2);
    const { rows } = await pool.query('SELECT id FROM sessions ORDER BY id');
    assert.deepEqual(rows.map(r => r.id), ['live-1']);
});

test('pruning removes job_runs history past the retention window only', async () => {
    await pool.query(
        `INSERT INTO job_runs (job_name, period_key, status, finished_at) VALUES
            ('old', 'x', 'succeeded', now() - make_interval(days => $1)),
            ('recent', 'x', 'succeeded', now() - interval '1 day')`,
        [JOB_RUN_RETENTION_DAYS + 1]
    );
    const out = await runJob(pruneSessionsJob, new Date(), quietLog);
    assert.equal(out.result.jobRunsDeleted, 1);
    const { rows } = await pool.query("SELECT job_name FROM job_runs WHERE period_key = 'x'");
    assert.deepEqual(rows.map(r => r.job_name), ['recent']);
});

// ─── #579: monthly net-worth snapshot ────────────────────────────────────────

let cookies;

function headers() {
    const csrf = cookies.match(/csrf=([^;]+)/)[1];
    return { 'Content-Type': 'application/json', Cookie: cookies, 'X-CSRF-Token': csrf };
}

async function api(method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    assert.ok(res.ok, `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
}

async function signIn(email = 'test@example.com') {
    const user = await createTestUser(email);
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return user;
}

const NOW = new Date(2026, 10, 15, 12); // 15 Nov 2026, local noon

// A dataset touching every source the snapshot reads: income (with
// withholding), a bonus, debts (amortizing and fixed), recurring
// subscription/income/transfer, a one-off transfer, manual transactions,
// an auto-contributing fund, account interest, a Ledger override and a
// Cleared entry.
async function seedRichDataset() {
    const checking = (await api('POST', '/api/accounts', { name: 'Checking', type: 'Checking', startingBalance: 1500, interestRate: 0 })).id;
    const savings = (await api('POST', '/api/accounts', { name: 'Savings', type: 'Savings', startingBalance: 5000, interestRate: 4.2 })).id;
    await api('POST', '/api/accounts', { name: 'Overdrawn', type: 'Checking', startingBalance: -250, interestRate: 0 });
    const income = (await api('POST', '/api/incomes', { name: 'Salary', amount: 2400, frequency: 'biweekly', firstPayDate: '2026-01-02', accountId: checking, withholdingPercent: 20 })).id;
    await api('POST', '/api/bonuses', { name: 'Award', amount: 600, date: '2026-11-20', accountId: checking });
    await api('POST', '/api/debts', { name: 'Visa', category: 'Credit Card', debtType: 'creditCard', accountBalance: 3200.55, minimumPayment: 95, interestRate: 21.9, dueDate: 14, accountId: checking });
    await api('POST', '/api/debts', { name: 'Loan', category: 'Other', debtType: 'fixedAmount', fixedAmount: 800, minimumPayment: 100, dueDate: 3, accountId: checking });
    await api('POST', '/api/recurring-templates', { name: 'Streaming', type: 'subscription', amount: 17.99, frequency: 'monthly', dayOfMonth: 8, category: 'Entertainment', accountId: checking });
    await api('POST', '/api/recurring-templates', { name: 'Side gig', type: 'income', amount: 300, frequency: 'monthly', dayOfMonth: 21, accountId: checking });
    await api('POST', '/api/recurring-templates', { name: 'Sweep', type: 'transfer', amount: 200, frequency: 'monthly', dayOfMonth: 1, accountId: checking, targetAccountId: savings });
    await api('POST', '/api/transfers', { fromAccountId: savings, toAccountId: checking, amount: 125, date: '2026-11-10' });
    await api('POST', '/api/manual-transactions', { accountId: checking, date: '2026-11-04', amount: -42.5, name: 'Groceries', category: 'Food' });
    await api('POST', '/api/manual-transactions', { accountId: checking, date: '2026-11-06', amount: 80, name: 'Refund', category: 'Other' });
    await api('POST', '/api/emergency-funds', { accountId: savings, targetAmount: 10000, currentAmount: 5000, monthlyContribution: 150, autoContribute: true });
    // Override the first November payday (13 Nov: biweekly from 2 Jan).
    const payKey = `income|${income}|${checking}|2026-11-13`;
    await api('PUT', `/api/ledger-overrides/${encodeURIComponent(payKey)}`, { amount: 2000, originalAmount: 1920 });
    await api('PUT', `/api/ledger-cleared/${encodeURIComponent(payKey)}`, { clearedAt: '2026-11-13T10:00:00.000Z' });
    await api('PUT', '/api/settings/autoNwSnapshot', { value: true });
    return { checking, savings };
}

// The object the browser's loadFromPostgres() builds, from the same GETs.
async function browserShapedState() {
    const ENDPOINTS = {
        persons: '/api/persons', debts: '/api/debts', accounts: '/api/accounts', incomes: '/api/incomes',
        bonuses: '/api/bonuses', bills: '/api/bills', expenses: '/api/expenses',
        recurringTemplates: '/api/recurring-templates', emergencyFunds: '/api/emergency-funds',
        sinkingFunds: '/api/sinking-funds', reconciliations: '/api/reconciliations', planHistory: '/api/plan-history',
        retirementSnapshots: '/api/retirement-snapshots', transfers: '/api/transfers',
        manualTransactions: '/api/manual-transactions', balanceHistory: '/api/balance-history',
    };
    const app = {};
    for (const [field, path] of Object.entries(ENDPOINTS)) app[field] = await api('GET', path);
    app.monthlySnapshots = await api('GET', '/api/net-worth-snapshots');
    app.settings = await api('GET', '/api/settings');
    app.ledgerAmountOverrides = Object.fromEntries((await api('GET', '/api/ledger-overrides')).map(o => [o.overrideKey, o]));
    app.ledgerClearedTransactions = Object.fromEntries((await api('GET', '/api/ledger-cleared')).map(c => [c.clearedKey, c]));
    return app;
}

async function storedSnapshots(userId) {
    const { rows } = await pool.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, total_assets, total_liabilities, net_worth,
                debt_payment_made, income_received, source
         FROM net_worth_snapshots WHERE user_id = $1 ORDER BY date`, [userId]);
    return rows.map(r => ({
        date: r.date, totalAssets: r.total_assets, totalLiabilities: r.total_liabilities, netWorth: r.net_worth,
        debtPaymentMade: r.debt_payment_made, incomeReceived: r.income_received, source: r.source,
    }));
}

test('loadUserState lists the same collections as the browser (src/storage.js)', () => {
    const storageSrc = readFileSync(new URL('../../src/storage.js', import.meta.url), 'utf8');
    const block = storageSrc.match(/POSTGRES_RESOURCE_ENDPOINTS = \{([\s\S]*?)\};/)[1];
    const browserFields = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);
    assert.deepEqual(Object.keys(USER_STATE_COLLECTIONS), browserFields);
});

test('loadUserState builds exactly the object the browser loads from the GET routes', async () => {
    const user = await signIn();
    await seedRichDataset();
    assert.deepEqual(await loadUserState(user.id), await browserShapedState());
});

test('the server snapshot equals the shared pure core run on the browser-loaded data', async () => {
    const user = await signIn();
    await seedRichDataset();
    const expected = buildNetWorthSnapshot(await browserShapedState(), NOW, 'auto');

    assert.equal(await captureSnapshotForUser(user.id, NOW), 'captured');
    const stored = await storedSnapshots(user.id);
    assert.deepEqual(stored, [expected]);

    // Sanity: the dataset really exercises the sources (not an all-zero match).
    assert.ok(expected.totalAssets > 0 && expected.totalLiabilities === 4000.55);
    assert.ok(expected.debtPaymentMade === 195 && expected.incomeReceived > 0);
});

test('snapshot values for a small dataset match a hand calculation', async () => {
    const user = await signIn();
    const acct = (await api('POST', '/api/accounts', { name: 'Checking', type: 'Checking', startingBalance: 1000, interestRate: 0 })).id;
    await api('POST', '/api/incomes', { name: 'Pay', amount: 2000, frequency: 'monthly', firstPayDate: '2026-01-05', accountId: acct });
    await api('POST', '/api/debts', { name: 'Card', category: 'Credit Card', debtType: 'creditCard', accountBalance: 500, minimumPayment: 50, interestRate: 10, dueDate: 10, accountId: acct });
    await api('POST', '/api/recurring-templates', { name: 'Gym', type: 'subscription', amount: 15, frequency: 'monthly', dayOfMonth: 3, accountId: acct });
    await api('PUT', '/api/settings/autoNwSnapshot', { value: true });

    assert.equal(await captureSnapshotForUser(user.id, NOW), 'captured');
    const [row] = await storedSnapshots(user.id);
    // 1000 + 2000 pay - 50 card - 15 gym = 2935 assets; 500 owed.
    assert.deepEqual(row, {
        date: NOW.toISOString().slice(0, 10), totalAssets: 2935, totalLiabilities: 500, netWorth: 2435,
        debtPaymentMade: 50, incomeReceived: 2000, source: 'auto',
    });
});

test('the snapshot job skips a month that already has a snapshot', async () => {
    const user = await signIn();
    await seedRichDataset();
    await api('PUT', '/api/net-worth-snapshots/2026-11-02', { totalAssets: 1, totalLiabilities: 0, netWorth: 1, source: 'manual' });

    assert.equal(await captureSnapshotForUser(user.id, NOW), 'exists');
    const stored = await storedSnapshots(user.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].date, '2026-11-02');
    assert.equal(stored[0].netWorth, 1);
});

test('a snapshot in another month does not block this month', async () => {
    const user = await signIn();
    await seedRichDataset();
    await api('PUT', '/api/net-worth-snapshots/2026-10-31', { totalAssets: 1, totalLiabilities: 0, netWorth: 1 });
    assert.equal(await captureSnapshotForUser(user.id, NOW), 'captured');
    assert.equal((await storedSnapshots(user.id)).length, 2);
});

test('a user with no accounts or debts gets no $0 snapshot', async () => {
    const user = await signIn('empty@example.com');
    assert.equal(await captureSnapshotForUser(user.id, NOW), 'empty');
    assert.deepEqual(await storedSnapshots(user.id), []);
    await api('POST', '/api/debts', { name: 'Card', debtType: 'creditCard', accountBalance: 300, interestRate: 20, minimumPayment: 25, dueDate: 5 });
    assert.equal(await captureSnapshotForUser(user.id, NOW), 'captured');
    assert.deepEqual((await storedSnapshots(user.id)).map(x => x.netWorth), [-300]);
});

test('the server captures even when the app setting is off or unset', async () => {
    // autoNwSnapshot governs only the app's own capture on load; the server job
    // runs for every user (JOBS_ENABLED=false is the server-wide off switch).
    const user = await signIn();
    await seedRichDataset();
    await api('PUT', '/api/settings/autoNwSnapshot', { value: false });
    assert.equal(await captureSnapshotForUser(user.id, NOW), 'captured');
    assert.equal((await storedSnapshots(user.id)).length, 1);

    const other = await signIn('unset@example.com');
    await api('POST', '/api/accounts', { name: 'U', type: 'Checking', startingBalance: 5, interestRate: 0 });
    await pool.query("DELETE FROM settings WHERE user_id = $1 AND key = 'autoNwSnapshot'", [other.id]);
    assert.equal(await captureSnapshotForUser(other.id, NOW), 'captured');
    assert.deepEqual((await storedSnapshots(other.id)).map(x => x.netWorth), [5]);
});

test('the job covers every user once per month, even when run again', async () => {
    const a = await signIn('a@example.com');
    await seedRichDataset();
    const b = await signIn('b@example.com');
    await api('POST', '/api/accounts', { name: 'B', type: 'Checking', startingBalance: 10, interestRate: 0 });
    await api('PUT', '/api/settings/autoNwSnapshot', { value: true });
    const c = await signIn('c@example.com'); // no accounts or debts

    const first = await runJob(netWorthSnapshotJob, NOW, quietLog);
    assert.equal(first.status, 'succeeded');
    assert.equal(first.periodKey, '2026-11');
    assert.deepEqual(first.result, { captured: 2, exists: 0, empty: 1, raced: 0, failed: 0 });
    assert.equal((await runJob(netWorthSnapshotJob, NOW, quietLog)).status, 'skipped');

    assert.equal((await storedSnapshots(a.id)).length, 1);
    assert.deepEqual((await storedSnapshots(b.id)).map(s => s.netWorth), [10]);
    assert.deepEqual(await storedSnapshots(c.id), []);
});

test('the job never overwrites a snapshot stored for the same date meanwhile', async () => {
    const user = await signIn();
    // A browser write that lands between the job's month check and its insert.
    await pool.query(
        `INSERT INTO net_worth_snapshots (user_id, date, total_assets, total_liabilities, net_worth, source)
         VALUES ($1, '2026-11-15', 7, 0, 7, 'manual')`, [user.id]);
    const inserted = await insertSnapshot(user.id, { date: '2026-11-15', totalAssets: 99, totalLiabilities: 0, netWorth: 99, source: 'auto' });
    assert.equal(inserted, false);
    const [row] = await storedSnapshots(user.id);
    assert.equal(row.netWorth, 7);
    assert.equal(row.source, 'manual');
});

test('an unsanitizable snapshot is rejected, not stored', async () => {
    const user = await signIn();
    await assert.rejects(insertSnapshot(user.id, { date: 'not-a-date', netWorth: 1 }), /sanitization/);
    assert.deepEqual(await storedSnapshots(user.id), []);
});
