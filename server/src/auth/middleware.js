import crypto from 'node:crypto';
import { query } from '../db.js';

export function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

// Sessions are looked up by a hash of the token, never the raw token --
// the raw value only ever exists in the client's cookie. This means a
// database read (backup leak, SQL injection elsewhere, admin access) can't
// be replayed as a session cookie the way a stored plaintext token could.
export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export async function requireSession(req, res, next) {
    const sessionToken = req.cookies?.session;
    if (!sessionToken) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    const sessionId = hashToken(sessionToken);
    const { rows } = await query('SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0 || new Date(rows[0].expires_at) <= new Date()) {
        if (rows.length > 0) await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        res.clearCookie('session');
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    req.userId = rows[0].user_id;
    // #683: the session's hash, so /api/sessions can mark the current one.
    req.sessionId = sessionId;
    // "Last active" for Settings -> Security, written at most once per
    // LAST_SEEN_THROTTLE_MS so ordinary requests don't each write a row.
    const lastSeen = rows[0].last_seen_at ? new Date(rows[0].last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen >= LAST_SEEN_THROTTLE_MS) {
        await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [sessionId]);
    }
    next();
}

export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookieToken = req.cookies?.csrf;
    const headerToken = req.get('X-CSRF-Token');
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: { code: 'CSRF_MISMATCH', message: 'Missing or invalid CSRF token' } });
    }
    next();
}
