import crypto from 'node:crypto';
import { query } from '../db.js';

export function generateToken() {
    return crypto.randomBytes(32).toString('base64url');
}

export async function requireSession(req, res, next) {
    const sessionId = req.cookies?.session;
    if (!sessionId) {
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    const { rows } = await query('SELECT user_id, expires_at FROM sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0 || new Date(rows[0].expires_at) <= new Date()) {
        if (rows.length > 0) await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
        res.clearCookie('session');
        return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    }
    req.userId = rows[0].user_id;
    next();
}

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
