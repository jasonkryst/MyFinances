import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, createTestUser, loginTestUser } from './helpers/testDb.js';
import { _setTransportOverride, _clearTransportOverride } from '../src/email/transport.js';
import { checkNotificationsForUser, notificationsJob, MAX_EMAIL_ATTEMPTS } from '../src/jobs/notifications.js';
import { pruneSessionsJob, NOTIFICATION_RETENTION_DAYS } from '../src/jobs/pruneSessions.js';
import { runJob } from '../src/jobs/runner.js';
import notificationEmail, { describeNotification, formatAmount, formatIsoDate } from '../src/email/templates/notificationEmail.js';

// Issue #211: bill-due and balance notifications.

let server, baseUrl, cookies, originalHost, originalFrom;
const quietLog = { log() {}, error() {} };

const NOW = new Date(2026, 10, 15, 12); // Sunday 15 Nov 2026, local noon
const TOMORROW = new Date(2026, 10, 16, 12);

before(() => {
    server = createApp().listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    originalHost = process.env.SMTP_HOST;
    originalFrom = process.env.SMTP_FROM;
});

after(async () => {
    server.close();
    await pool.end();
    if (originalHost === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = originalHost;
    if (originalFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = originalFrom;
    _clearTransportOverride();
});

beforeEach(async () => {
    await resetDb();
    delete process.env.SMTP_HOST;
    _clearTransportOverride();
});

function recordingTransport({ fail = false } = {}) {
    const sent = [];
    return {
        sent,
        sendMail: async (mail) => {
            if (fail) throw new Error('SMTP down');
            sent.push(mail);
            return { messageId: 'x' };
        },
    };
}

function useSmtp(transport) {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'alerts@myfinances.test';
    _setTransportOverride(transport);
}

function headers(withCsrf = true) {
    const h = { 'Content-Type': 'application/json', Cookie: cookies };
    if (withCsrf) h['X-CSRF-Token'] = cookies.match(/csrf=([^;]+)/)[1];
    return h;
}

async function call(method, path, body, { csrf = true } = {}) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: headers(csrf), body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function api(method, path, body) {
    const res = await call(method, path, body);
    assert.ok(res.status < 300, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
}

async function signIn(email = 'notify@example.com') {
    const user = await createTestUser(email);
    const login = await loginTestUser(baseUrl, user.email, user.password);
    cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return user;
}

// A checking account at 100 with a 150 alert, a debt due today (50) and one
// due in 2 days (20): balance today 50, so one low-balance alert and two
// bill alerts.
async function seedLowAccountWithBills() {
    const account = await api('POST', '/api/accounts', { name: 'Checking', type: 'Checking', startingBalance: 100, lowBalanceThreshold: 150 });
    await api('POST', '/api/debts', { name: 'Visa', accountBalance: 900, interestRate: 20, minimumPayment: 50, dueDate: 15, accountId: account.id });
    await api('POST', '/api/debts', { name: 'Store card', accountBalance: 300, interestRate: 25, minimumPayment: 20, dueDate: 17, accountId: account.id });
    return account;
}

async function rows(userId) {
    const { rows: list } = await pool.query(
        'SELECT type, dedupe_key, episode_key, show_in_app, email_status, email_attempts, read_at, resolved_at, params FROM notifications WHERE user_id = $1 ORDER BY id',
        [userId]
    );
    return list;
}

const setSetting = (key, value) => api('PUT', `/api/settings/${key}`, { value });

// ─── Computing and storing alerts ────────────────────────────────────────────

test('a check stores bill-due and balance alerts and lists them in-app', async () => {
    const user = await signIn();
    const account = await seedLowAccountWithBills();
    const result = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual(result, { created: 3, resolved: 0, sent: 0, failed: 0 });

    const stored = await rows(user.id);
    assert.deepEqual(stored.map(r => r.type).sort(), ['billDueSoon', 'billDueToday', 'lowBalance']);
    assert.ok(stored.every(r => r.show_in_app && r.email_status === 'none'), 'no SMTP: in-app only');
    const low = stored.find(r => r.type === 'lowBalance');
    assert.equal(low.episode_key, `lowBalance|${account.id}`);
    assert.deepEqual(low.params, { accountId: account.id, accountName: 'Checking', balance: 50, threshold: 150 });

    const list = await api('GET', '/api/notifications');
    assert.equal(list.unreadCount, 3);
    assert.equal(list.emailConfigured, false);
    assert.equal(list.notifications.length, 3);
    for (const n of list.notifications) {
        assert.deepEqual(Object.keys(n).sort(), ['createdAt', 'id', 'params', 'readAt', 'resolvedAt', 'type']);
        assert.equal(n.readAt, null);
    }
    const soon = list.notifications.find(n => n.type === 'billDueSoon');
    assert.equal(soon.params.name, 'Store card');
    assert.equal(soon.params.dueDate, '2026-11-17');
});

test('a repeated check raises nothing twice', async () => {
    const user = await signIn();
    await seedLowAccountWithBills();
    await checkNotificationsForUser(user.id, NOW, quietLog);
    const again = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(again.created, 0);
    const later = await checkNotificationsForUser(user.id, new Date(2026, 10, 15, 18), quietLog);
    assert.equal(later.created, 0, 'still the same day: same alerts');
    assert.equal((await rows(user.id)).length, 3);
});

test('a balance alert stays open while low, resolves on recovery and alerts again on the next dip', async () => {
    const user = await signIn();
    const account = await seedLowAccountWithBills();
    await checkNotificationsForUser(user.id, NOW, quietLog);

    // Still low the next day: the open episode suppresses a new alert.
    let r = await checkNotificationsForUser(user.id, TOMORROW, quietLog);
    assert.equal((await rows(user.id)).filter(x => x.type === 'lowBalance').length, 1);
    assert.equal(r.resolved, 0);

    // Recovers: the episode is resolved.
    await api('PATCH', `/api/accounts/${account.id}`, { startingBalance: 5000 });
    r = await checkNotificationsForUser(user.id, TOMORROW, quietLog);
    assert.equal(r.resolved, 1);
    const resolved = (await rows(user.id)).find(x => x.type === 'lowBalance');
    assert.ok(resolved.resolved_at, 'resolved_at set');

    // Dips again two days later: a new alert.
    await api('PATCH', `/api/accounts/${account.id}`, { startingBalance: 100 });
    r = await checkNotificationsForUser(user.id, new Date(2026, 10, 17, 9), quietLog);
    const lows = (await rows(user.id)).filter(x => x.type === 'lowBalance');
    assert.equal(lows.length, 2);
    assert.equal(lows[1].dedupe_key, `lowBalance|${account.id}|2026-11-17`);
    assert.equal(lows[1].resolved_at, null);
});

test('removing the threshold resolves the open low-balance alert', async () => {
    const user = await signIn();
    const account = await seedLowAccountWithBills();
    await checkNotificationsForUser(user.id, NOW, quietLog);
    await api('PATCH', `/api/accounts/${account.id}`, { lowBalanceThreshold: null });
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.resolved, 1);
});

test('a switched-off alert type is not raised, and its open episode resolves', async () => {
    const user = await signIn();
    await seedLowAccountWithBills();
    await setSetting('notifyBillDue', false);
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual((await rows(user.id)).map(r => r.type), ['lowBalance']);

    await setSetting('notifyLowBalance', false);
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.resolved, 1);
});

test('the server refuses invalid notification preferences', async () => {
    await signIn();
    for (const [key, value] of [['notifyDaysAhead', 31], ['notifyDaysAhead', 'x'], ['notifyChannel', 'sms'], ['notifyDelivery', 'weekly'], ['notifyBillDue', 'yes']]) {
        const res = await call('PUT', `/api/settings/${key}`, { value });
        assert.equal(res.status, 400, `${key}=${JSON.stringify(value)}`);
    }
    for (const [key, value] of [['notifyDaysAhead', 0], ['notifyChannel', 'inApp'], ['notifyDelivery', 'digest'], ['notifyZeroBalance', false]]) {
        const res = await call('PUT', `/api/settings/${key}`, { value });
        assert.ok(res.status < 300, `${key}=${JSON.stringify(value)} -> ${res.status}`);
    }
});

test('0 days ahead alerts only on the due date', async () => {
    const user = await signIn();
    await seedLowAccountWithBills();
    await setSetting('notifyDaysAhead', 0);
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual((await rows(user.id)).map(r => r.type).sort(), ['billDueToday', 'lowBalance']);
});

test('an account at exactly $0 is not overdrawn and raises nothing', async () => {
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Parked', type: 'Savings', startingBalance: 0 });
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.created, 0);
    assert.deepEqual(await rows(user.id), []);
});

test('muteBalanceAlerts round-trips through the accounts route and defaults to false', async () => {
    await signIn();
    const plain = await api('POST', '/api/accounts', { name: 'A', type: 'Checking', startingBalance: 10 });
    assert.equal(plain.muteBalanceAlerts, false);
    const muted = await api('POST', '/api/accounts', { name: 'B', type: 'Checking', startingBalance: 10, muteBalanceAlerts: true });
    assert.equal(muted.muteBalanceAlerts, true);
    const listed = (await api('GET', '/api/accounts')).find(a => a.id === muted.id);
    assert.equal(listed.muteBalanceAlerts, true);
    const patched = await api('PATCH', `/api/accounts/${muted.id}`, { muteBalanceAlerts: 'yes' });
    assert.equal(patched.muteBalanceAlerts, false, 'only a real true mutes');
});

test('muting an account raises no balance alerts but keeps its bill alerts', async () => {
    const user = await signIn();
    const account = await seedLowAccountWithBills();
    await api('PATCH', `/api/accounts/${account.id}`, { muteBalanceAlerts: true, startingBalance: -20 });
    await checkNotificationsForUser(user.id, NOW, quietLog);
    const types = (await rows(user.id)).map(r => r.type).sort();
    assert.deepEqual(types, ['billDueSoon', 'billDueToday']);
});

test('muting closes the account open alerts and cancels their unsent emails; other accounts keep theirs', async () => {
    const user = await signIn();
    const account = await seedLowAccountWithBills();
    const other = await api('POST', '/api/accounts', { name: 'Other', type: 'Checking', startingBalance: -5 });
    await setSetting('notifyBillDue', false);
    await checkNotificationsForUser(user.id, NOW, quietLog);
    // SMTP is off in tests, so mark both open alerts as waiting to be emailed.
    await pool.query(`UPDATE notifications SET email_status = 'pending' WHERE user_id = $1`, [user.id]);

    await api('PATCH', `/api/accounts/${account.id}`, { muteBalanceAlerts: true });
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.resolved, 1);
    const after = await rows(user.id);
    const mine = after.find(x => x.episode_key === `lowBalance|${account.id}`);
    assert.notEqual(mine.resolved_at, null);
    assert.equal(mine.email_status, 'none');
    const theirs = after.find(x => x.episode_key === `zeroBalance|${other.id}`);
    assert.equal(theirs.resolved_at, null);
    assert.equal(theirs.email_status, 'pending');
});

test('unmuting alerts again on the next check', async () => {
    const user = await signIn();
    const account = await api('POST', '/api/accounts', { name: 'C', type: 'Checking', startingBalance: -5, muteBalanceAlerts: true });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 0);
    await api('PATCH', `/api/accounts/${account.id}`, { muteBalanceAlerts: false });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 1);
});

test('liability and archived accounts never raise balance alerts', async () => {
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Card', type: 'Credit Card', startingBalance: -500, lowBalanceThreshold: 100 });
    await api('POST', '/api/accounts', { name: 'Old', type: 'Checking', startingBalance: -10, archived: true });
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.created, 0);
});

// ─── Email ───────────────────────────────────────────────────────────────────

test('by default each alert is emailed on its own and also shown in-app', async () => {
    const transport = recordingTransport();
    useSmtp(transport);
    const user = await signIn();
    await seedLowAccountWithBills();
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual(r, { created: 3, resolved: 0, sent: 3, failed: 0 });
    assert.equal(transport.sent.length, 3);
    assert.ok(transport.sent.every(m => m.to === 'notify@example.com' && m.from === 'alerts@myfinances.test'));
    assert.deepEqual(transport.sent.map(m => m.subject).sort(), ['MyFinances: Bill due today', 'MyFinances: Low balance', 'MyFinances: Upcoming bill']);
    assert.ok((await rows(user.id)).every(x => x.email_status === 'sent' && x.email_attempts === 1 && x.show_in_app));
    assert.equal((await api('GET', '/api/notifications')).emailConfigured, true);

    // Nothing is emailed twice.
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(transport.sent.length, 3);
});

test('digest delivery sends one email listing every new alert', async () => {
    const transport = recordingTransport();
    useSmtp(transport);
    const user = await signIn();
    await seedLowAccountWithBills();
    await setSetting('notifyDelivery', 'digest');
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.sent, 3);
    assert.equal(transport.sent.length, 1);
    assert.equal(transport.sent[0].subject, 'MyFinances: 3 alerts');
    assert.equal(transport.sent[0].text.split('\n').filter(l => l.startsWith('- ')).length, 3);
});

test('in-app only sends no email; email only hides alerts from the in-app list', async () => {
    const transport = recordingTransport();
    useSmtp(transport);
    const user = await signIn();
    await seedLowAccountWithBills();
    await setSetting('notifyChannel', 'inApp');
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(transport.sent.length, 0);
    assert.ok((await rows(user.id)).every(x => x.email_status === 'none'));

    await resetDb();
    const user2 = await signIn('second@example.com');
    await seedLowAccountWithBills();
    await setSetting('notifyChannel', 'email');
    await checkNotificationsForUser(user2.id, NOW, quietLog);
    assert.equal(transport.sent.length, 3);
    const list = await api('GET', '/api/notifications');
    assert.deepEqual(list.notifications, []);
    assert.equal(list.unreadCount, 0);
});

test('a failed email never fails the check, is retried, and gives up after the last attempt', async () => {
    useSmtp(recordingTransport({ fail: true }));
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Empty', type: 'Checking', startingBalance: -1 });
    let r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual(r, { created: 1, resolved: 0, sent: 0, failed: 1 });
    assert.deepEqual((await rows(user.id)).map(x => [x.email_status, x.email_attempts]), [['pending', 1]]);

    for (let i = 2; i <= MAX_EMAIL_ATTEMPTS; i++) r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.deepEqual((await rows(user.id)).map(x => [x.email_status, x.email_attempts]), [['failed', MAX_EMAIL_ATTEMPTS]]);

    // A working transport later does not resend a failed alert.
    const transport = recordingTransport();
    useSmtp(transport);
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(transport.sent.length, 0);
});

test('a pending email is retried on the next check once SMTP works', async () => {
    useSmtp(recordingTransport({ fail: true }));
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Empty', type: 'Checking', startingBalance: -1 });
    await checkNotificationsForUser(user.id, NOW, quietLog);
    const transport = recordingTransport();
    useSmtp(transport);
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.sent, 1);
    assert.equal(transport.sent.length, 1);
    assert.deepEqual((await rows(user.id)).map(x => [x.email_status, x.email_attempts]), [['sent', 2]]);
});

test('pending emails older than the retry window are marked failed, not sent', async () => {
    const transport = recordingTransport();
    useSmtp(transport);
    const user = await signIn();
    await pool.query(
        `INSERT INTO notifications (user_id, type, dedupe_key, params, email_status, created_at)
         VALUES ($1, 'zeroBalance', 'old', '{}', 'pending', now() - interval '3 days')`,
        [user.id]
    );
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(transport.sent.length, 0);
    assert.equal((await rows(user.id))[0].email_status, 'failed');
});

test('the email template describes each alert, escapes names and keeps the subject fixed', () => {
    const one = notificationEmail({ items: [{ type: 'billDueSoon', params: { name: '<b>Rent</b>', amount: 1200, daysUntil: 2, dueDate: '2026-11-17', accountName: 'Checking' } }] });
    assert.equal(one.subject, 'MyFinances: Upcoming bill');
    assert.equal(one.text.split('\n')[0], '<b>Rent</b> (1,200.00) is due in 2 days, on Nov 17, 2026 from Checking.');
    assert.ok(one.html.includes('&lt;b&gt;Rent&lt;/b&gt;'));
    assert.ok(!one.html.includes('<b>Rent'));

    assert.equal(describeNotification('billDueSoon', { name: 'Gym', amount: 30, daysUntil: 1, dueDate: '2026-11-16' }), 'Gym (30.00) is due tomorrow, on Nov 16, 2026.');
    assert.equal(describeNotification('billDueToday', { name: 'Gym', amount: 30 }), 'Gym (30.00) is due today.');
    assert.equal(describeNotification('lowBalance', { accountName: 'Checking', balance: 50, threshold: 150 }), 'Checking is at 50.00, at or below your alert amount of 150.00.');
    assert.equal(describeNotification('zeroBalance', { accountName: 'Checking', balance: -5 }), 'Checking is overdrawn at -5.00.');
    assert.equal(describeNotification('projectedLow', { accountName: 'Checking', projectedBalance: 40, date: '2026-11-18', threshold: 100 }),
        'Checking is projected to drop to 40.00 on Nov 18, 2026, at or below your alert amount of 100.00.');
    assert.equal(describeNotification('projectedLow', { accountName: 'Checking', projectedBalance: -1, date: '2026-11-18', threshold: null }),
        'Checking is projected to go below zero (-1.00) on Nov 18, 2026.');
    // #681
    assert.equal(describeNotification('promoEnding', { name: 'Store Card', promoEndDate: '2027-01-14', regularRate: 26.99, balance: 1200 }),
        'The promotional rate on Store Card ends on Jan 14, 2027, then 26.99% APR applies to the 1,200.00 balance.');
    assert.equal(describeNotification('promoEnding', { promoEndDate: '2027-01-14', balance: 5, deferredInterest: true }),
        'The promotional rate on A debt ends on Jan 14, 2027, then 0% APR applies to the 5.00 balance. Deferred interest is charged back if a balance remains.');
    assert.equal(notificationEmail({ items: [{ type: 'promoEnding', params: { name: 'X', promoEndDate: '2027-01-14', balance: 1 } }] }).subject,
        'MyFinances: Promotional rate ending');
    assert.equal(describeNotification('unknown', {}), 'You have a new MyFinances alert.');
    assert.equal(formatAmount('x'), '');
    assert.equal(formatIsoDate('2026-13'), '');

    const digest = notificationEmail({ items: [{ type: 'zeroBalance', params: { accountName: 'A', balance: 0 } }, { type: 'zeroBalance', params: { accountName: '<i>B</i>', balance: 0 } }] });
    assert.equal(digest.subject, 'MyFinances: 2 alerts');
    assert.ok(digest.html.includes('&lt;i&gt;B&lt;/i&gt;'));
});

// ─── Routes ──────────────────────────────────────────────────────────────────

test('the notification routes need a session and the CSRF token', async () => {
    for (const [method, path] of [['GET', '/api/notifications'], ['POST', '/api/notifications/read-all'], ['POST', '/api/notifications/check'], ['DELETE', '/api/notifications']]) {
        const res = await fetch(`${baseUrl}${path}`, { method });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
    await signIn();
    for (const [method, path] of [['POST', '/api/notifications/read-all'], ['POST', '/api/notifications/check'], ['DELETE', '/api/notifications']]) {
        const res = await call(method, path, undefined, { csrf: false });
        assert.equal(res.status, 403, `${method} ${path} without CSRF`);
    }
});

test('mark one read, mark all read, and delete all', async () => {
    const user = await signIn();
    await seedLowAccountWithBills();
    await checkNotificationsForUser(user.id, NOW, quietLog);
    const { notifications } = await api('GET', '/api/notifications');

    const one = await api('POST', `/api/notifications/${notifications[0].id}/read`);
    assert.equal(one.id, notifications[0].id);
    assert.ok(one.readAt);
    assert.equal((await api('GET', '/api/notifications')).unreadCount, 2);
    // Reading again keeps the first read time.
    const again = await api('POST', `/api/notifications/${notifications[0].id}/read`);
    assert.equal(again.readAt, one.readAt);

    const all = await api('POST', '/api/notifications/read-all');
    assert.equal(all.updated, 2);
    assert.equal((await api('GET', '/api/notifications')).unreadCount, 0);

    const del = await api('DELETE', '/api/notifications');
    assert.equal(del.deleted, 3);
    assert.deepEqual((await api('GET', '/api/notifications')).notifications, []);
});

test('read rejects a bad id and never touches another user\'s alert', async () => {
    const owner = await signIn('owner@example.com');
    await seedLowAccountWithBills();
    await checkNotificationsForUser(owner.id, NOW, quietLog);
    const { notifications } = await api('GET', '/api/notifications');

    await signIn('other@example.com');
    assert.equal((await call('POST', '/api/notifications/abc/read')).status, 400);
    assert.equal((await call('POST', '/api/notifications/0/read')).status, 400);
    assert.equal((await call('POST', `/api/notifications/${notifications[0].id}/read`)).status, 404);
    assert.deepEqual((await api('GET', '/api/notifications')).notifications, []);
    assert.equal((await api('POST', '/api/notifications/read-all')).updated, 0);
    assert.equal((await api('DELETE', '/api/notifications')).deleted, 0);
    assert.equal((await rows(owner.id)).filter(r => r.read_at === null).length, 3, 'owner untouched');
});

test('POST /check runs the check for the signed-in user now', async () => {
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Overdrawn', type: 'Checking', startingBalance: -1 });
    const res = await api('POST', '/api/notifications/check');
    assert.deepEqual(res, { ok: true, created: 1, resolved: 0, sent: 0, failed: 0 });
    assert.deepEqual((await rows(user.id)).map(r => r.type), ['zeroBalance']);
    assert.equal((await api('POST', '/api/notifications/check')).created, 0);
});

test('the list is capped at the 50 newest', async () => {
    const user = await signIn();
    await pool.query(
        `INSERT INTO notifications (user_id, type, dedupe_key, params, created_at)
         SELECT $1, 'zeroBalance', 'k' || g, '{}', now() - make_interval(mins => g) FROM generate_series(1, 60) g`,
        [user.id]
    );
    const list = await api('GET', '/api/notifications');
    assert.equal(list.notifications.length, 50);
    assert.equal(list.unreadCount, 60);
});

// ─── The hourly job and pruning ──────────────────────────────────────────────

test('the job checks every user', async () => {
    const a = await signIn('a@example.com');
    await api('POST', '/api/accounts', { name: 'A', type: 'Checking', startingBalance: -1 });
    const b = await signIn('b@example.com');
    await api('POST', '/api/accounts', { name: 'B', type: 'Savings', startingBalance: -1 });
    const out = await runJob(notificationsJob, NOW, quietLog);
    assert.equal(out.status, 'succeeded');
    assert.deepEqual(out.result, { users: 2, created: 2, resolved: 0, sent: 0, failed: 0 });
    assert.equal((await rows(a.id)).length, 1);
    assert.equal((await rows(b.id)).length, 1);
    assert.equal(notificationsJob.periodKey(NOW), '2026-11-15T12');
});

test('pruning removes old alerts but keeps an open balance alert', async () => {
    const user = await createTestUser();
    const old = NOTIFICATION_RETENTION_DAYS + 1;
    await pool.query(
        `INSERT INTO notifications (user_id, type, dedupe_key, episode_key, params, created_at, resolved_at) VALUES
            ($1, 'billDueToday', 'old-bill', NULL, '{}', now() - make_interval(days => $2), NULL),
            ($1, 'lowBalance', 'old-resolved', 'lowBalance|1', '{}', now() - make_interval(days => $2), now()),
            ($1, 'lowBalance', 'old-open', 'lowBalance|2', '{}', now() - make_interval(days => $2), NULL),
            ($1, 'billDueToday', 'recent', NULL, '{}', now() - interval '1 day', NULL)`,
        [user.id, old]
    );
    const out = await runJob(pruneSessionsJob, new Date(), quietLog);
    assert.equal(out.result.notificationsDeleted, 2);
    const { rows: left } = await pool.query('SELECT dedupe_key FROM notifications ORDER BY dedupe_key');
    assert.deepEqual(left.map(r => r.dedupe_key), ['old-open', 'recent']);
});

// ─── The account field ───────────────────────────────────────────────────────

test('accounts store a positive low-balance threshold and null anything else', async () => {
    await signIn();
    const a = await api('POST', '/api/accounts', { name: 'A', type: 'Checking', startingBalance: 10, lowBalanceThreshold: 250.5 });
    assert.equal(a.lowBalanceThreshold, 250.5);
    const listed = (await api('GET', '/api/accounts')).find(x => x.id === a.id);
    assert.equal(listed.lowBalanceThreshold, 250.5);
    for (const bad of [-5, 0, 'abc', null]) {
        const patched = await api('PATCH', `/api/accounts/${a.id}`, { lowBalanceThreshold: bad });
        assert.equal(patched.lowBalanceThreshold, null, JSON.stringify(bad));
    }
    const plain = await api('POST', '/api/accounts', { name: 'B', type: 'Savings', startingBalance: 10 });
    assert.equal(plain.lowBalanceThreshold, null);
});

test('deleting the user removes their notifications', async () => {
    const user = await signIn();
    await api('POST', '/api/accounts', { name: 'Empty', type: 'Checking', startingBalance: -1 });
    await checkNotificationsForUser(user.id, NOW, quietLog);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 0);
});

// ─── Sinking fund behind (#701) ──────────────────────────────────────────────

// Target 2027-05-15 from 2026-11-15: 6 months left, 1800 to go = 300/mo
// required against a planned 200/mo, so the fund is behind.
async function seedBehindFund(fields = {}) {
    const account = await api('POST', '/api/accounts', { name: 'Savings', type: 'Savings', startingBalance: 5000 });
    const fund = await api('POST', '/api/sinking-funds', {
        name: 'Vacation', allocationMethod: 'target_date', targetDate: '2027-05-15', targetAmount: 3000,
        currentAmount: 1200, monthlyAllocation: 200, accountId: account.id, ...fields,
    });
    return { account, fund };
}

const sinkRows = async userId => (await rows(userId)).filter(r => r.type === 'sinkingBehind');

test('a behind fund raises one alert per episode, and a repeat check raises nothing', async () => {
    const user = await signIn();
    const { fund } = await seedBehindFund();
    const r = await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(r.created, 1);
    const [row] = await sinkRows(user.id);
    assert.equal(row.episode_key, `sinkingBehind|${fund.id}|2027-05-15|behind`);
    assert.equal(row.dedupe_key, `${row.episode_key}|2026-11-15`);
    assert.deepEqual(row.params, { name: 'Vacation', fundId: fund.id, kind: 'behind', targetDate: '2027-05-15', targetAmount: 3000, remaining: 1800, required: 300, planned: 200 });

    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 0);
    // The next day the open episode still suppresses a new row.
    const next = await checkNotificationsForUser(user.id, TOMORROW, quietLog);
    assert.equal(next.created, 0);
    assert.equal((await sinkRows(user.id)).length, 1);
});

test('a slip under 10%, a funded fund and a fixed-method fund raise nothing', async () => {
    const user = await signIn();
    const { fund } = await seedBehindFund({ monthlyAllocation: 290 });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 0);
    await api('PATCH', `/api/sinking-funds/${fund.id}`, { monthlyAllocation: 200, currentAmount: 3000 });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 0);
    await api('PATCH', `/api/sinking-funds/${fund.id}`, { currentAmount: 1200, allocationMethod: 'fixed' });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).created, 0);
    assert.equal((await sinkRows(user.id)).length, 0);
});

test('the open alert resolves when the fund catches up, is funded, changes date or is deleted', async () => {
    const user = await signIn();
    const { fund } = await seedBehindFund();
    const path = `/api/sinking-funds/${fund.id}`;
    const open = async () => (await sinkRows(user.id)).filter(r => !r.resolved_at).length;
    const day = d => new Date(2026, 10, d, 12);

    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(await open(), 1);

    // Caught up: 1000 left over 6 months is 167/mo, under 220.
    await api('PATCH', path, { currentAmount: 2000 });
    assert.equal((await checkNotificationsForUser(user.id, NOW, quietLog)).resolved, 1);
    assert.equal(await open(), 0);

    // Funded.
    await api('PATCH', path, { currentAmount: 1200 });
    await checkNotificationsForUser(user.id, day(16), quietLog);
    assert.equal(await open(), 1);
    await api('PATCH', path, { currentAmount: 3000 });
    assert.equal((await checkNotificationsForUser(user.id, day(16), quietLog)).resolved, 1);

    // A later date lowers the requirement under the threshold.
    await api('PATCH', path, { currentAmount: 1200 });
    await checkNotificationsForUser(user.id, day(17), quietLog);
    assert.equal(await open(), 1);
    await api('PATCH', path, { targetDate: '2028-05-15' });
    assert.equal((await checkNotificationsForUser(user.id, day(17), quietLog)).resolved, 1);

    // Deleted.
    await api('PATCH', path, { targetDate: '2027-05-15' });
    await checkNotificationsForUser(user.id, day(18), quietLog);
    assert.equal(await open(), 1);
    await api('DELETE', path);
    assert.equal((await checkNotificationsForUser(user.id, day(18), quietLog)).resolved, 1);
    assert.equal(await open(), 0);
});

test('behind turning past due is a new alert; the old one resolves', async () => {
    const user = await signIn();
    const { fund } = await seedBehindFund({ targetDate: '2026-12-15' });
    await checkNotificationsForUser(user.id, NOW, quietLog);
    const later = new Date(2027, 0, 5, 12);
    const r = await checkNotificationsForUser(user.id, later, quietLog);
    assert.equal(r.created, 1);
    assert.equal(r.resolved, 1);
    const list = await sinkRows(user.id);
    assert.deepEqual(list.map(x => x.params.kind), ['behind', 'pastDue']);
    assert.equal(list[1].episode_key, `sinkingBehind|${fund.id}|2026-12-15|pastDue`);
    assert.equal(list[1].params.remaining, 1800);
    assert.equal((await checkNotificationsForUser(user.id, later, quietLog)).created, 0);
});

test('notifySinkingBehind false raises nothing and resolves an open alert', async () => {
    const user = await signIn();
    await seedBehindFund();
    await checkNotificationsForUser(user.id, NOW, quietLog);
    await setSetting('notifySinkingBehind', false);
    const r = await checkNotificationsForUser(user.id, TOMORROW, quietLog);
    assert.equal(r.created, 0);
    assert.equal(r.resolved, 1);
    const bad = await call('PUT', '/api/settings/notifySinkingBehind', { value: 'no' });
    assert.equal(bad.status, 400);
});

test('the sinking fund alert is emailed per event and in a digest', async () => {
    const user = await signIn();
    const transport = recordingTransport();
    useSmtp(transport);
    await seedBehindFund();
    await seedBehindFund({ name: 'Car', targetDate: '2026-05-01' });
    await checkNotificationsForUser(user.id, NOW, quietLog);
    assert.equal(transport.sent.length, 2);
    assert.deepEqual(transport.sent.map(m => m.subject), ['MyFinances: Sinking fund behind', 'MyFinances: Sinking fund behind']);
    const text = transport.sent.map(m => m.text).join('\n');
    assert.ok(text.includes('Vacation is behind: 300.00/mo now needed (planned 200.00) to reach 3,000.00 by May 2027.'), text);
    assert.ok(text.includes('Car passed its target date (May 1, 2026) with 1,800.00 still to save.'), text);

    await resetDb();
    const user2 = await signIn('digest@example.com');
    const t2 = recordingTransport();
    useSmtp(t2);
    await setSetting('notifyDelivery', 'digest');
    await seedBehindFund();
    await checkNotificationsForUser(user2.id, NOW, quietLog);
    assert.equal(t2.sent.length, 1);
});

test('describeNotification words the sinking fund alerts', () => {
    assert.equal(describeNotification('sinkingBehind', { name: 'Vacation', kind: 'behind', required: 450, planned: 300, targetAmount: 3000, targetDate: '2027-06-01' }),
        'Vacation is behind: 450.00/mo now needed (planned 300.00) to reach 3,000.00 by Jun 2027.');
    assert.equal(describeNotification('sinkingBehind', { kind: 'pastDue', remaining: 1200, targetDate: '2026-05-01' }),
        'A sinking fund passed its target date (May 1, 2026) with 1,200.00 still to save.');
});
