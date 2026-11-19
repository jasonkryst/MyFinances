import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { MAX_LIST_LIMIT, parseIdList } from '../src/routes/notifications.js';

let server, baseUrl, cookies, user;

function csrfHeaders() {
    const csrfToken = cookies.match(/csrf=([^;]+)/)[1];
    return { Cookie: cookies, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' };
}

async function post(path, body) {
    return fetch(`${baseUrl}/api/notifications${path}`, { method: 'POST', headers: csrfHeaders(), body: JSON.stringify(body) });
}

async function insertRows(userId, n, prefix = 'k') {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const { rows } = await query(
            `INSERT INTO notifications (user_id, type, dedupe_key, params, show_in_app)
             VALUES ($1, 'billDueSoon', $2, '{}', true) RETURNING id`,
            [userId, `${prefix}-${i}`]
        );
        ids.push(Number(rows[0].id));
    }
    return ids;
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

beforeEach(async () => {
    await resetDb();
    user = await createTestUser('page@example.com');
    const loginRes = await loginTestUser(baseUrl, user.email, user.password);
    cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
});

async function list(qs = '') {
    return fetch(`${baseUrl}/api/notifications${qs}`, { headers: { Cookie: cookies } });
}

test('limit defaults to 50 and total counts everything', async () => {
    await insertRows(user.id, 60);
    const body = await (await list()).json();
    assert.equal(body.notifications.length, 50);
    assert.equal(body.total, 60);
    assert.equal(body.unreadCount, 60);
});

test('limit=500 returns all 60', async () => {
    await insertRows(user.id, 60);
    const res = await list('?limit=500');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).notifications.length, 60);
});

test('invalid limits are 400', async () => {
    for (const v of ['0', '501', '1.5', 'abc', '-1', '']) {
        const res = await list(`?limit=${v}`);
        assert.equal(res.status, 400, `limit=${v}`);
    }
});

test('bulk read marks only the given ids and returns unreadCount', async () => {
    const ids = await insertRows(user.id, 4);
    const res = await post('/read', { ids: [ids[0], ids[1]] });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, updated: 2, unreadCount: 2 });
    const { rows } = await query('SELECT id FROM notifications WHERE read_at IS NOT NULL ORDER BY id');
    assert.deepEqual(rows.map(r => Number(r.id)), [ids[0], ids[1]]);
});

test('bulk read ignores another user\'s ids', async () => {
    const other = await createTestUser('other@example.com');
    const [theirs] = await insertRows(other.id, 1, 'o');
    const [mine] = await insertRows(user.id, 1);
    const res = await post('/read', { ids: [theirs, mine] });
    const body = await res.json();
    assert.equal(body.updated, 1);
    const { rows } = await query('SELECT read_at FROM notifications WHERE id = $1', [theirs]);
    assert.equal(rows[0].read_at, null);
});

test('bulk unread clears read_at', async () => {
    const ids = await insertRows(user.id, 2);
    await post('/read', { ids });
    const res = await post('/unread', { ids: [ids[0]] });
    assert.deepEqual(await res.json(), { ok: true, updated: 1, unreadCount: 1 });
    const { rows } = await query('SELECT read_at FROM notifications WHERE id = $1', [ids[0]]);
    assert.equal(rows[0].read_at, null);
});

test('stale ids are fine', async () => {
    const ids = await insertRows(user.id, 2);
    await query('DELETE FROM notifications WHERE id = ANY($1::bigint[])', [ids]);
    const res = await post('/read', { ids });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.updated, 0);
    assert.equal(body.unreadCount, 0);
});

test('ids validation', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    const bodies = [{}, { ids: [] }, { ids: tooMany }, { ids: [1, 1] }, { ids: [0] }, { ids: [-3] },
        { ids: ['2'] }, { ids: [1.5] }, { ids: 'abc' }, { ids: null }];
    for (const path of ['/read', '/unread']) {
        for (const b of bodies) {
            const res = await post(path, b);
            assert.equal(res.status, 400, `${path} ${JSON.stringify(b).slice(0, 40)}`);
        }
    }
});

test('parseIdList and MAX_LIST_LIMIT', () => {
    assert.equal(MAX_LIST_LIMIT, 500);
    assert.deepEqual(parseIdList([1, 2]), [1, 2]);
    assert.equal(parseIdList([1, 1]), null);
    assert.equal(parseIdList(undefined), null);
});

test('both POSTs require a session (401) and csrf (403)', async () => {
    for (const path of ['/read', '/unread']) {
        const noSession = await fetch(`${baseUrl}/api/notifications${path}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [1] })
        });
        assert.equal(noSession.status, 401);
        const noCsrf = await fetch(`${baseUrl}/api/notifications${path}`, {
            method: 'POST', headers: { Cookie: cookies, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [1] })
        });
        assert.equal(noCsrf.status, 403);
    }
});
