import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { sendTemplatedEmail } from '../email/send.js';
import { isEmailConfigured } from '../email/transport.js';
import { checkNotificationsForUser } from '../jobs/notifications.js';

// #211: the in-app list shows the newest LIST_LIMIT alerts.
export const LIST_LIMIT = 50;

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
        try {
            const [{ rows }, { rows: countRows }] = await Promise.all([
                query(
                    `SELECT id, type, params, created_at, read_at, resolved_at FROM notifications
                      WHERE user_id = $1 AND show_in_app
                      ORDER BY created_at DESC, id DESC LIMIT $2`,
                    [req.userId, LIST_LIMIT]
                ),
                query(
                    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND show_in_app AND read_at IS NULL',
                    [req.userId]
                ),
            ]);
            res.json({ notifications: rows.map(toNotification), unreadCount: countRows[0].n, emailConfigured: isEmailConfigured() });
        } catch (err) {
            next(err);
        }
    });

    router.post('/read-all', async (req, res, next) => {
        try {
            const { rowCount } = await query(
                'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
                [req.userId]
            );
            res.json({ ok: true, updated: rowCount });
        } catch (err) {
            next(err);
        }
    });

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
