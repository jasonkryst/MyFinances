// Change log (#580): every create/update/delete through the generic routers
// and the plan-settings PATCH writes one audit_log row in the same statement;
// rows older than the retention window are pruned.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { recordJsonSql, auditCteSql, AUDIT_LOG_RETENTION_DAYS } from '../src/audit.js';
import { parseAuditQuery, AUDITED_TABLES, AUDIT_MAX_LIST_LIMIT } from '../src/routes/auditLog.js';
import { pruneSessionsJob, pruneAuditLog } from '../src/jobs/pruneSessions.js';
import { RESOURCE_TABLES } from '../../src/resourceDeletion.js';

let server, baseUrl, cookies, userId;

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await pool.end(); });

async function login(email) {
    const user = await createTestUser(email);
    const res = await loginTestUser(baseUrl, user.email, user.password);
    return { id: user.id, cookies: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}

beforeEach(async () => {
    await resetDb();
    const u = await login('audit@example.com');
    cookies = u.cookies;
    userId = u.id;
});

function hdrs(c = cookies) {
    return { 'Content-Type': 'application/json', Cookie: c, 'X-CSRF-Token': c.match(/csrf=([^;]+)/)[1] };
}
async function call(method, path, body, c = cookies) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: hdrs(c), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function auditRows(where = '') {
    const { rows } = await pool.query(`SELECT * FROM audit_log WHERE user_id = $1 ${where} ORDER BY id`, [userId]);
    return rows;
}

// ─── Pure SQL builders ──────────────────────────────────────────────────────

test('recordJsonSql maps API fields to the alias columns', () => {
    assert.equal(recordJsonSql('x', { id: 'id', startingBalance: 'starting_balance' }),
        "jsonb_build_object('id', x.id, 'startingBalance', x.starting_balance)");
});

test('recordJsonSql splits wide records under the 100-argument limit', () => {
    const columns = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`f${i}`, `c${i}`]));
    const sql = recordJsonSql('r', columns);
    const calls = sql.split(' || ');
    assert.equal(calls.length, 3);
    for (const c of calls) assert.ok((c.match(/'f\d+'/g) || []).length <= 50);
});

test('recordJsonSql of no columns is an empty object', () => {
    assert.equal(recordJsonSql('r', {}), "'{}'::jsonb");
});

test('auditCteSql skips unchanged updates only when both sides are given', () => {
    const both = auditCteSql({ table: 't', op: 'update', source: 's', rowId: 's.id', before: 'B', after: 'A' });
    assert.match(both, /WHERE \(B\) IS DISTINCT FROM \(A\)/);
    const create = auditCteSql({ table: 't', op: 'create', source: 's', rowId: 's.id', after: 'A' });
    assert.doesNotMatch(create, /IS DISTINCT FROM/);
    assert.match(create, /'create', NULL, A/);
});

test('parseAuditQuery accepts defaults and clamps limit', () => {
    assert.deepEqual(parseAuditQuery({}), { limit: 50, before: null, table: null });
    assert.equal(parseAuditQuery({ limit: '9999' }).limit, AUDIT_MAX_LIST_LIMIT);
    assert.equal(parseAuditQuery({ limit: '0' }).limit, 1);
    assert.equal(parseAuditQuery({ table: 'all' }).table, null);
    assert.equal(parseAuditQuery({ table: 'debts', before: '12' }).before, '12');
});

test('parseAuditQuery rejects bad limit, cursor and table', () => {
    assert.ok(parseAuditQuery({ limit: '-1' }).error);
    assert.ok(parseAuditQuery({ limit: 'ten' }).error);
    assert.ok(parseAuditQuery({ before: '1 OR 1=1' }).error);
    assert.ok(parseAuditQuery({ table: 'users' }).error);
    assert.ok(parseAuditQuery({ table: "debts'; DROP TABLE audit_log; --" }).error);
});

test('AUDITED_TABLES covers every collection table plus plan_settings', () => {
    const expected = new Set([...Object.values(RESOURCE_TABLES), 'plan_settings']);
    assert.deepEqual(new Set(AUDITED_TABLES), expected);
});

// ─── CRUD router ────────────────────────────────────────────────────────────

test('create, update and delete each write one audit row with before/after', async () => {
    const created = await call('POST', '/api/accounts', { name: 'Checking', type: 'Checking', startingBalance: 100 });
    assert.equal(created.status, 201);
    const id = created.body.id;
    let rows = await auditRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].table_name, 'accounts');
    assert.equal(rows[0].op, 'create');
    assert.equal(rows[0].row_id, String(id));
    assert.equal(rows[0].before, null);
    assert.equal(rows[0].after.name, 'Checking');
    assert.equal(rows[0].after.id, id);
    assert.equal('rowVersion' in rows[0].after, false, 'rowVersion is not part of the logged record');

    const patched = await call('PATCH', `/api/accounts/${id}`, { name: 'Main', rowVersion: 1 });
    assert.equal(patched.status, 200);
    rows = await auditRows();
    assert.equal(rows.length, 2);
    assert.equal(rows[1].op, 'update');
    assert.equal(rows[1].before.name, 'Checking');
    assert.equal(rows[1].after.name, 'Main');

    assert.equal((await call('DELETE', `/api/accounts/${id}`)).status, 204);
    rows = await auditRows();
    assert.equal(rows.length, 3);
    assert.equal(rows[2].op, 'delete');
    assert.equal(rows[2].before.name, 'Main');
    assert.equal(rows[2].after, null);
});

test('an update that changes nothing writes no audit row', async () => {
    const id = (await call('POST', '/api/accounts', { name: 'Checking', type: 'Checking' })).body.id;
    assert.equal((await call('PATCH', `/api/accounts/${id}`, { name: 'Checking' })).status, 200);
    assert.equal((await auditRows("AND op = 'update'")).length, 0);
});

test('rejected writes write no audit row', async () => {
    const id = (await call('POST', '/api/accounts', { name: 'Checking', type: 'Checking' })).body.id;
    const conflict = await call('PATCH', `/api/accounts/${id}`, { name: 'X', rowVersion: 99 });
    assert.equal(conflict.status, 409);
    assert.equal((await call('PATCH', '/api/accounts/999999', { name: 'X' })).status, 404);
    assert.equal((await call('DELETE', '/api/accounts/999999')).status, 404);
    assert.equal((await call('POST', '/api/transfers', { fromAccountId: id, toAccountId: id, amount: 5, date: '2026-01-01' })).status, 400);
    const rows = await auditRows();
    assert.deepEqual(rows.map(r => r.op), ['create']);
});

test('bulk DELETE logs one row per deleted record', async () => {
    await call('POST', '/api/persons', { name: 'A' });
    await call('POST', '/api/persons', { name: 'B' });
    assert.equal((await call('DELETE', '/api/persons')).status, 204);
    const deletes = await auditRows("AND op = 'delete'");
    assert.deepEqual(deletes.map(r => r.before.name).sort(), ['A', 'B']);
});

test('a cascaded delete is not logged for the child table', async () => {
    const accountId = (await call('POST', '/api/accounts', { name: 'Card', type: 'Credit Card' })).body.id;
    const debt = await call('POST', '/api/debts', { name: 'Visa', accountBalance: 500, interestRate: 20, minimumPayment: 25, accountId });
    await call('POST', '/api/balance-history', { debtId: debt.body.id, date: '2026-01-01', balance: 500 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM balance_history')).rows[0].n, 1);
    await pool.query('DELETE FROM audit_log');
    assert.equal((await call('DELETE', `/api/debts/${debt.body.id}`)).status, 204);
    const rows = await auditRows();
    assert.deepEqual(rows.map(r => `${r.table_name}:${r.op}`), ['debts:delete']);
});

// ─── Keyed router ───────────────────────────────────────────────────────────

test('a keyed PUT logs create, then update, and an unchanged PUT logs nothing', async () => {
    assert.equal((await call('PUT', '/api/settings/showArchivedDebts', { value: true })).status, 200);
    assert.equal((await call('PUT', '/api/settings/showArchivedDebts', { value: false })).status, 200);
    assert.equal((await call('PUT', '/api/settings/showArchivedDebts', { value: false })).status, 200);
    const rows = await auditRows("AND table_name = 'settings'");
    assert.deepEqual(rows.map(r => r.op), ['create', 'update']);
    assert.equal(rows[0].row_id, 'showArchivedDebts');
    assert.equal(rows[0].before, null);
    assert.equal(rows[1].before.value, true);
    assert.equal(rows[1].after.value, false);
});

test('a keyed DELETE logs the removed entry; a missing key logs nothing', async () => {
    await call('PUT', '/api/settings/showArchivedDebts', { value: true });
    assert.equal((await call('DELETE', '/api/settings/showArchivedDebts')).status, 204);
    assert.equal((await call('DELETE', '/api/settings/showArchivedDebts')).status, 404);
    const deletes = await auditRows("AND op = 'delete'");
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].before.key, 'showArchivedDebts');
});

test('a rejected keyed PUT writes no audit row', async () => {
    assert.equal((await call('PUT', '/api/settings/notARealSetting', { value: 1 })).status, 400);
    assert.equal((await auditRows()).length, 0);
});

// ─── Plan settings ──────────────────────────────────────────────────────────

test('a plan-settings PATCH of a plan field is logged; view state is not', async () => {
    await call('GET', '/api/plan-settings');
    assert.equal((await call('PATCH', '/api/plan-settings', { strategy: 'snowball' })).status, 200);
    assert.equal((await call('PATCH', '/api/plan-settings', { ledgerSettings: { accountFilter: 'all', pageSize: 50 } })).status, 200);
    const rows = await auditRows("AND table_name = 'plan_settings'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].op, 'update');
    assert.equal(rows[0].row_id, 'plan');
    assert.equal(rows[0].after.strategy, 'snowball');
    assert.equal('ledgerSettings' in rows[0].after, false);
});

// ─── Read and clear API ─────────────────────────────────────────────────────

test('GET /api/audit-log lists newest first, pages with before, filters by table', async () => {
    for (const name of ['A', 'B', 'C']) await call('POST', '/api/persons', { name });
    await call('POST', '/api/accounts', { name: 'Checking', type: 'Checking' });
    const first = await call('GET', '/api/audit-log?limit=2');
    assert.equal(first.status, 200);
    assert.equal(first.body.entries.length, 2);
    assert.equal(first.body.hasMore, true);
    assert.equal(first.body.entries[0].table, 'accounts');
    assert.equal(first.body.entries[0].op, 'create');
    assert.ok(first.body.entries[0].at);
    const next = await call('GET', `/api/audit-log?limit=2&before=${first.body.entries[1].id}`);
    assert.equal(next.body.entries.length, 2);
    assert.equal(next.body.hasMore, false);
    const persons = await call('GET', '/api/audit-log?table=persons');
    assert.deepEqual(persons.body.entries.map(e => e.after.name), ['C', 'B', 'A']);
});

test('GET /api/audit-log rejects a bad filter', async () => {
    assert.equal((await call('GET', '/api/audit-log?table=users')).status, 400);
    assert.equal((await call('GET', '/api/audit-log?before=abc')).status, 400);
});

test('the audit log is per user', async () => {
    await call('POST', '/api/persons', { name: 'Mine' });
    const other = await login('other@example.com');
    const list = await call('GET', '/api/audit-log', undefined, other.cookies);
    assert.deepEqual(list.body.entries, []);
    assert.equal((await call('DELETE', '/api/audit-log', undefined, other.cookies)).status, 204);
    assert.equal((await auditRows()).length, 1, "another user's clear leaves my log alone");
});

test('DELETE /api/audit-log empties the log', async () => {
    await call('POST', '/api/persons', { name: 'A' });
    assert.equal((await call('DELETE', '/api/audit-log')).status, 204);
    assert.equal((await call('GET', '/api/audit-log')).body.entries.length, 0);
});

test('the audit log needs a session and a CSRF token to clear', async () => {
    const anon = await fetch(`${baseUrl}/api/audit-log`);
    assert.equal(anon.status, 401);
    const noCsrf = await fetch(`${baseUrl}/api/audit-log`, { method: 'DELETE', headers: { Cookie: cookies } });
    assert.equal(noCsrf.status, 403);
});

// ─── Retention ──────────────────────────────────────────────────────────────

test('pruning removes rows older than the retention window and keeps newer ones', async () => {
    await call('POST', '/api/persons', { name: 'Old' });
    await call('POST', '/api/persons', { name: 'New' });
    await pool.query(
        `UPDATE audit_log SET at = now() - make_interval(days => $1 + 1) WHERE after->>'name' = 'Old'`,
        [AUDIT_LOG_RETENTION_DAYS]
    );
    await pool.query(
        `UPDATE audit_log SET at = now() - make_interval(days => $1 - 1) WHERE after->>'name' = 'New'`,
        [AUDIT_LOG_RETENTION_DAYS]
    );
    assert.equal(await pruneAuditLog(), 1);
    const rows = await auditRows();
    assert.deepEqual(rows.map(r => r.after.name), ['New']);
});

test('the hourly prune job also prunes the audit log', async () => {
    await call('POST', '/api/persons', { name: 'Old' });
    await pool.query(`UPDATE audit_log SET at = now() - interval '400 days'`);
    const result = await pruneSessionsJob.run();
    assert.equal(result.auditRowsDeleted, 1);
});

test('deleting a user removes their audit rows', async () => {
    await call('POST', '/api/persons', { name: 'A' });
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM audit_log');
    assert.equal(rows[0].n, 0);
});

test('the migration creates audit_log idempotently with a reversible down()', () => {
    const src = readFileSync(new URL('../migrations/1755600000043_create-audit-log.js', import.meta.url), 'utf8');
    assert.match(src, /CREATE TABLE IF NOT EXISTS audit_log/);
    assert.match(src, /DROP TABLE IF EXISTS audit_log/);
    assert.match(src, /MIGRATION SAFETY NOTE/);
});

test("the Change history filter lists exactly the server's audited tables", async () => {
    const { AUDIT_TABLE_ORDER } = await import('../../src/changeHistoryCore.js');
    assert.deepEqual(new Set(AUDIT_TABLE_ORDER), new Set(AUDITED_TABLES));
});
