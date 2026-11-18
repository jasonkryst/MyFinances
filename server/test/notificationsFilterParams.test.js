import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { parseNotificationFilterQuery } from '../src/routes/notifications.js';

let server, baseUrl, cookies, user, other;

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { Cookie: cookies, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' };
}

before(() => {
    const app = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.close();
    await pool.end();
});

let seq = 0;
async function insert(userId, type, accountId, { read = false, resolved = false } = {}) {
    const params = accountId === null ? {} : { accountId };
    await query(
        `INSERT INTO notifications (user_id, type, dedupe_key, params, show_in_app, read_at, resolved_at)
         VALUES ($1, $2, $3, $4, true, ${read ? 'now()' : 'NULL'}, ${resolved ? 'now()' : 'NULL'})`,
        [userId, type, `fp-${seq++}`, JSON.stringify(params)]
    );
}

async function list(qs = '') {
    return fetch(`${baseUrl}/api/notifications${qs}`, { headers: { Cookie: cookies } });
}

async function readAll(qs = '') {
    return fetch(`${baseUrl}/api/notifications/read-all${qs}`, { method: 'POST', headers: csrfHeaders(), body: '{}' });
}

beforeEach(async () => {
    await resetDb();
    user = await createTestUser('fp@example.com');
    other = await createTestUser('fp-other@example.com');
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    // user: 7 rows. other: 2 rows that must never show up.
    await insert(user.id, 'billDueSoon', 1);
    await insert(user.id, 'billDueToday', 2, { read: true });
    await insert(user.id, 'lowBalance', 1);
    await insert(user.id, 'zeroBalance', 2, { resolved: true });
    await insert(user.id, 'zeroBalance', 1, { read: true, resolved: true });
    await insert(user.id, 'projectedLow', null);
    await insert(user.id, 'projectedLow', 2);
    await insert(other.id, 'zeroBalance', 1);
    await insert(other.id, 'lowBalance', 2);
});

const typesOf = (body) => body.notifications.map(n => n.type).sort();

test('parse: defaults, values and invalid input', () => {
    assert.deepEqual(parseNotificationFilterQuery({}), { types: null, status: 'all', accountId: null });
    assert.deepEqual(parseNotificationFilterQuery({ type: 'bill', status: 'unread', account: '3' }),
        { types: ['billDueSoon', 'billDueToday'], status: 'unread', accountId: 3 });
    assert.deepEqual(parseNotificationFilterQuery({ type: 'all', account: 'all' }), { types: null, status: 'all', accountId: null });
    for (const bad of [
        { type: 'bogus' }, { type: 'other' }, { status: 'x' }, { status: '' }, { account: '0' }, { account: '-1' },
        { account: '1.5' }, { account: '' }, { account: '9007199254740993' }, { type: ['bill', 'bill'] },
        { type: ['bill'] }, { status: ['read', 'read'] }, { account: ['1', '2'] },
    ]) {
        assert.equal(parseNotificationFilterQuery(bad), null, JSON.stringify(bad));
    }
});

test('no params: identical to before (everything, newest first)', async () => {
    const body = await (await list()).json();
    assert.equal(body.notifications.length, 7);
    assert.equal(body.total, 7);
    assert.equal(body.unreadCount, 5);
});

test('each type value returns only matching rows', async () => {
    const cases = {
        bill: ['billDueSoon', 'billDueToday'],
        lowBalance: ['lowBalance'],
        overdrawn: ['zeroBalance', 'zeroBalance'],
        projected: ['projectedLow', 'projectedLow'],
    };
    for (const [type, expected] of Object.entries(cases)) {
        const res = await list(`?type=${type}`);
        assert.equal(res.status, 200, type);
        const body = await res.json();
        assert.deepEqual(typesOf(body), expected, type);
        assert.equal(body.total, expected.length, type);
    }
    assert.equal((await (await list('?type=all')).json()).notifications.length, 7);
});

test('each status value returns only matching rows', async () => {
    const counts = { unread: 5, read: 2, active: 5, resolved: 2, all: 7 };
    for (const [status, n] of Object.entries(counts)) {
        const body = await (await list(`?status=${status}`)).json();
        assert.equal(body.notifications.length, n, status);
        assert.equal(body.total, n, status);
        if (status === 'unread') assert.ok(body.notifications.every(x => x.readAt === null));
        if (status === 'read') assert.ok(body.notifications.every(x => x.readAt !== null));
        if (status === 'active') assert.ok(body.notifications.every(x => x.resolvedAt === null));
        if (status === 'resolved') assert.ok(body.notifications.every(x => x.resolvedAt !== null));
    }
});

test('account filter returns only that account; rows without accountId are excluded', async () => {
    const body = await (await list('?account=2')).json();
    assert.equal(body.notifications.length, 3);
    assert.ok(body.notifications.every(n => n.params.accountId === 2));
    assert.equal((await (await list('?account=all')).json()).notifications.length, 7);
    assert.equal((await (await list('?account=99')).json()).notifications.length, 0);
});

test('unreadCount ignores status but follows type and account; total follows all three', async () => {
    let body = await (await list('?status=read')).json();
    assert.equal(body.unreadCount, 5);
    assert.equal(body.total, 2);

    body = await (await list('?type=bill&status=read')).json();
    assert.equal(body.unreadCount, 1);
    assert.equal(body.total, 1);

    body = await (await list('?account=2&status=resolved')).json();
    assert.equal(body.unreadCount, 2); // unread on account 2: billDueToday is read, zero resolved, projected
    assert.equal(body.total, 1);

    body = await (await list('?type=overdrawn&account=1&status=unread')).json();
    assert.equal(body.unreadCount, 0);
    assert.equal(body.total, 0);
});

test('read-all with a type marks only that type', async () => {
    const res = await readAll('?type=overdrawn');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).updated, 1); // only the one unread zeroBalance
    const { rows } = await query(
        `SELECT type FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY type`, [user.id]);
    assert.deepEqual(rows.map(r => r.type), ['billDueSoon', 'lowBalance', 'projectedLow', 'projectedLow']);
});

test('read-all with an account marks only that account; status is ignored', async () => {
    const res = await readAll('?account=1&status=read');
    assert.equal((await res.json()).updated, 2);
    const { rows } = await query(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [user.id]);
    assert.equal(rows[0].n, 3);
});

test('read-all with no params marks everything, and never another user', async () => {
    const res = await readAll();
    assert.equal((await res.json()).updated, 5);
    const { rows } = await query(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [other.id]);
    assert.equal(rows[0].n, 2);
});

test('invalid filter params are 400 on GET and read-all, and read-all changes nothing', async () => {
    for (const qs of ['?type=bogus', '?status=x', '?account=0', '?account=-1', '?account=1.5', '?type=bill&type=bill']) {
        assert.equal((await list(qs)).status, 400, `GET ${qs}`);
        assert.equal((await readAll(qs)).status, 400, `read-all ${qs}`);
    }
    const { rows } = await query(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [user.id]);
    assert.equal(rows[0].n, 5);
});

test("another user's rows never appear and are never counted", async () => {
    const body = await (await list('?type=overdrawn&account=1')).json();
        assert.equal(body.total, 1); // user's resolved+read zeroBalance on account 1 only
    assert.equal(body.unreadCount, 0);
});
