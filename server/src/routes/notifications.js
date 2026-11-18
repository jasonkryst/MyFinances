import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { sendTemplatedEmail } from '../email/send.js';
import { isEmailConfigured } from '../email/transport.js';
import { checkNotificationsForUser } from '../jobs/notifications.js';
import { typesForCategory } from '../../../src/notificationsFilter.js';

// #211: the in-app list shows the newest LIST_LIMIT alerts.
export const LIST_LIMIT = 50;
// The Notifications page may ask for more, up to this many.
export const MAX_LIST_LIMIT = 500;

// A non-empty array of up to MAX_LIST_LIMIT unique positive safe integers, or null.
export function parseIdList(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST_LIMIT) return null;
    for (const v of value) {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return null;
    }
    if (new Set(value).size !== value.length) return null;
    return value;
}

const FILTER_STATUSES = ['unread', 'read', 'active', 'resolved', 'all'];
const STATUS_SQL = {
    unread: 'read_at IS NULL',
    read: 'read_at IS NOT NULL',
    active: 'resolved_at IS NULL',
    resolved: 'resolved_at IS NOT NULL',
};

// Optional ?type=&status=&account= filters (#649). Missing means all. Returns
// { types, status, accountId } or null when any value is invalid (400).
export function parseNotificationFilterQuery(q) {
    const src = q || {};
    const one = (v) => (v === undefined ? undefined : typeof v === 'string' ? v : null);
    const type = one(src.type);
    const status = one(src.status);
    const account = one(src.account);
    if (type === null || status === null || account === null) return null;

    let types = null;
    if (type !== undefined && type !== 'all') {
        types = typesForCategory(type);
        if (!types) return null;
    }
    let st = 'unread';
    if (status !== undefined) {
        if (!FILTER_STATUSES.includes(status)) return null;
        st = status;
    }
    // No status param means no status filter on the server (legacy behaviour).
    const statusOut = status === undefined ? 'all' : st;

    let accountId = null;
    if (account !== undefined && account !== 'all') {
        if (!/^\d+$/.test(account)) return null;
        accountId = Number(account);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
    }
    return { types, status: statusOut, accountId };
}

// WHERE for the filters. withStatus false is for the unread count / read-all.
function filterWhere(userId, filter, withStatus) {
    const params = [userId];
    let sql = 'user_id = $1 AND show_in_app';
    if (filter.types) {
        params.push(filter.types);
        sql += ` AND type = ANY($${params.length}::text[])`;
    }
    if (filter.accountId !== null) {
        params.push(String(filter.accountId));
        sql += ` AND params->>'accountId' = $${params.length}::text`;
    }
    if (withStatus && STATUS_SQL[filter.status]) sql += ` AND ${STATUS_SQL[filter.status]}`;
    return { sql, params };
}

const NO_FILTER = { types: null, status: 'all', accountId: null };

async function countUnread(userId, filter = NO_FILTER) {
    const { sql, params } = filterWhere(userId, filter, false);
    const { rows } = await query(
        `SELECT count(*)::int AS n FROM notifications WHERE ${sql} AND read_at IS NULL`,
        params
    );
    return rows[0].n;
}

function invalidFilter(res) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'type, status and account must each be given once with a valid value' } });
}

function toNotification(row) {
    return {
        id: row.id,
        type: row.type,
        params: row.params || {},
        createdAt: row.created_at,
        readAt: row.read_at,
        resolvedAt: row.resolved_at,
    };
}

export default function createNotificationsRouter() {
    const router = express.Router();

    const testEmailLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
    });

    router.post('/test-email', testEmailLimiter, async (req, res, next) => {
        if (!isEmailConfigured()) {
            return res.status(503).json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'SMTP is not configured on this server' } });
        }

        let email;
        try {
            const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.userId]);
            if (rows.length === 0) {
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
            }
            email = rows[0].email;
        } catch (err) {
            return next(err);
        }

        try {
            await sendTemplatedEmail(email, 'testEmail', { to: email });
            res.json({ ok: true });
        } catch (err) {
            console.error('[notifications] test-email send failed:', err);
            res.status(502).json({ error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send test email' } });
        }
    });


    // #211: the in-app alert list (newest first) and the unread count.
    router.get('/', async (req, res, next) => {
        let limit = LIST_LIMIT;
        if (req.query.limit !== undefined) {
            const raw = req.query.limit;
            limit = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `limit must be an integer from 1 to ${MAX_LIST_LIMIT}` } });
            }
        }
        const filter = parseNotificationFilterQuery(req.query);
        if (!filter) return invalidFilter(res);
        try {
            const w = filterWhere(req.userId, filter, true);
            const [{ rows }, unreadCount, { rows: totalRows }] = await Promise.all([
                query(
                    `SELECT id, type, params, created_at, read_at, resolved_at FROM notifications
                      WHERE ${w.sql}
                      ORDER BY created_at DESC, id DESC LIMIT $${w.params.length + 1}`,
                    [...w.params, limit]
                ),
                countUnread(req.userId, filter),
                query(`SELECT count(*)::int AS n FROM notifications WHERE ${w.sql}`, w.params),
            ]);
            res.json({ notifications: rows.map(toNotification), unreadCount, total: totalRows[0].n, emailConfigured: isEmailConfigured() });
        } catch (err) {
            next(err);
        }
    });

    router.post('/read-all', async (req, res, next) => {
        const parsed = parseNotificationFilterQuery(req.query);
        if (!parsed) return invalidFilter(res);
        try {
            // Only type and account narrow it; status is ignored (unread only).
            // The legacy call marked every row, including ones hidden from the app.
            const hasFilter = parsed.types || parsed.accountId !== null;
            const w = filterWhere(req.userId, { ...parsed, status: 'all' }, false);
            const { rowCount } = await query(
                `UPDATE notifications SET read_at = now() WHERE ${hasFilter ? w.sql : 'user_id = $1'} AND read_at IS NULL`,
                hasFilter ? w.params : [req.userId]
            );
            res.json({ ok: true, updated: rowCount });
        } catch (err) {
            next(err);
        }
    });

    // Bulk mark read/unread for the Notifications page. Another user's or a
    // deleted id is simply not updated, so a stale selection is not an error.
    for (const [path, set] of [['/read', 'read_at = COALESCE(read_at, now())'], ['/unread', 'read_at = NULL']]) {
        router.post(path, async (req, res, next) => {
            const ids = parseIdList(req.body?.ids);
            if (!ids) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: `ids must be 1 to ${MAX_LIST_LIMIT} unique positive integers` } });
            }
            try {
                const { rowCount } = await query(
                    `UPDATE notifications SET ${set} WHERE user_id = $1 AND id = ANY($2::bigint[])`,
                    [req.userId, ids]
                );
                res.json({ ok: true, updated: rowCount, unreadCount: await countUnread(req.userId) });
            } catch (err) {
                next(err);
            }
        });
    }

    router.post('/:id/read', async (req, res, next) => {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid notification id' } });
        }
        try {
            const { rows } = await query(
                `UPDATE notifications SET read_at = COALESCE(read_at, now())
                  WHERE id = $1 AND user_id = $2
                  RETURNING id, type, params, created_at, read_at, resolved_at`,
                [id, req.userId]
            );
            if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
            res.json(toNotification(rows[0]));
        } catch (err) {
            next(err);
        }
    });

    // Clear All Data (pgDeleteAll) removes the alert history too.
    router.delete('/', async (req, res, next) => {
        try {
            const { rowCount } = await query('DELETE FROM notifications WHERE user_id = $1', [req.userId]);
            res.json({ ok: true, deleted: rowCount });
        } catch (err) {
            next(err);
        }
    });

    // Runs the background check for this user now ("Check now" in Settings).
    // It does not need JOBS_ENABLED: it is the user's own request.
    const checkLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
    });

    router.post('/check', checkLimiter, async (req, res, next) => {
        try {
            const result = await checkNotificationsForUser(req.userId, new Date());
            res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
