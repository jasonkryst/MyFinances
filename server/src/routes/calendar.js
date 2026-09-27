// Calendar feed routes:
//   GET  /api/calendar/token   — get existing calendar token (session-auth)
//   POST /api/calendar/token   — generate / regenerate token (session-auth, CSRF)
// The public endpoint GET /calendar.ics?token=xxx is registered separately on
// the top-level Express app (outside the session-auth api sub-router) in app.js.

import express from 'express';
import { randomBytes } from 'crypto';
import { query } from '../db.js';
import { generateIcsFromDbRows } from '../calendarGenerator.js';

const router = express.Router();

const DEFAULT_LEDGER = { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc' };
const DEFAULT_FORECAST = { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 };

router.get('/token', async (req, res, next) => {
    try {
        const { rows } = await query(
            'SELECT calendar_token FROM plan_settings WHERE user_id = $1',
            [req.userId]
        );
        res.json({ token: rows[0]?.calendar_token ?? null });
    } catch (err) {
        next(err);
    }
});

router.post('/token', async (req, res, next) => {
    try {
        const token = randomBytes(16).toString('hex');
        await query(
            `INSERT INTO plan_settings (user_id, ledger_settings, forecast_settings, calendar_token)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET calendar_token = $4`,
            [req.userId, JSON.stringify(DEFAULT_LEDGER), JSON.stringify(DEFAULT_FORECAST), token]
        );
        res.json({ token });
    } catch (err) {
        next(err);
    }
});

export default router;

// Public calendar handler — attached at GET /calendar.ics on the top-level
// app (no session required; authenticated solely via the calendar token).
export async function handlePublicCalendar(req, res, next) {
    try {
        const { token } = req.query;
        // Validate token format before hitting the DB (32 hex chars = 128-bit entropy).
        if (!token || !/^[0-9a-f]{32}$/.test(token)) {
            return res.status(401).end();
        }
        const { rows } = await query(
            'SELECT user_id FROM plan_settings WHERE calendar_token = $1',
            [token]
        );
        if (rows.length === 0) return res.status(401).end();
        const ics = await generateIcsFromDbRows(rows[0].user_id);
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="myfinances.ics"');
        res.send(ics);
    } catch (err) {
        next(err);
    }
}
