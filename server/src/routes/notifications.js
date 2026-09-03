import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { sendTemplatedEmail } from '../email/send.js';
import { isEmailConfigured } from '../email/transport.js';

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

    return router;
}
