import express from 'express';
import { query } from '../db.js';
import { summarizeUserAgent } from '../auth/sessionInfo.js';

// #683: the signed-in user's active sessions (Settings -> Security).
// Every query is scoped by req.userId, so a user can never list or revoke
// another user's sessions; an id that isn't theirs is a plain 404. The id
// exposed is sessions.public_id, never the token hash.
const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT id, public_id, created_at, last_seen_at, user_agent, ip_prefix
             FROM sessions WHERE user_id = $1 AND expires_at > now()
             ORDER BY (id = $2) DESC, COALESCE(last_seen_at, created_at) DESC`,
            [req.userId, req.sessionId]
        );
        res.json(rows.map(r => {
            const { browser, os } = summarizeUserAgent(r.user_agent);
            return {
                id: r.public_id,
                createdAt: r.created_at,
                lastSeenAt: r.last_seen_at ?? r.created_at,
                browser,
                os,
                ip: r.ip_prefix,
                current: r.id === req.sessionId
            };
        }));
    } catch (err) {
        next(err);
    }
});

// DELETE /api/sessions?others=1 signs out every session but this one.
router.delete('/', async (req, res, next) => {
    try {
        if (req.query.others !== '1') {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Use ?others=1 to sign out the other sessions' } });
        }
        const { rowCount } = await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.userId, req.sessionId]);
        res.json({ revoked: rowCount });
    } catch (err) {
        next(err);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        if (!UUID_RE.test(req.params.id)) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        }
        const { rows } = await query(
            'DELETE FROM sessions WHERE user_id = $1 AND public_id = $2 RETURNING id',
            [req.userId, req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
        }
        // Revoking the current session is a sign-out.
        if (rows[0].id === req.sessionId) {
            res.clearCookie('session');
            res.clearCookie('csrf');
        }
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

export default router;
