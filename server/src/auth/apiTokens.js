import crypto from 'node:crypto';
import { query } from '../db.js';
import { hashToken, requireSession } from './middleware.js';

// #581: read-only personal API tokens for scripts and dashboards.
//
// A token is sent as `Authorization: Bearer mft_...`. It only ever:
// - authenticates under /api (never /auth or /health; requireSession stays
//   cookie-only),
// - allows GET and HEAD (scope 'read'),
// - and never reaches the routes that manage credentials: sessions, API tokens
//   and the calendar feed token.
// A browser cookie session always wins when both are present. CSRF isn't
// needed: a token request carries no cookies and can't change anything.

export const TOKEN_PREFIX = 'mft_';
export const MAX_TOKENS_PER_USER = 25;
export const LAST_USED_THROTTLE_MS = 60 * 1000;
const READ_METHODS = new Set(['GET', 'HEAD']);
// Path prefixes a token may never read (credential management).
export const TOKEN_DENIED_PATHS = ['/api/sessions', '/api/api-tokens', '/api/calendar'];

export function generateApiToken() {
    return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

// The bearer token from an Authorization header, or null.
export function parseBearer(header) {
    if (typeof header !== 'string') return null;
    const m = header.match(/^Bearer\s+(mft_[A-Za-z0-9_-]{43})\s*$/);
    return m ? m[1] : null;
}

// Express doesn't decode or normalize originalUrl, so compare lowercased and
// with duplicate or trailing slashes collapsed (routing is case-insensitive).
export function isDeniedPath(path) {
    const p = String(path || '').split('?')[0].toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return TOKEN_DENIED_PATHS.some(d => p === d || p.startsWith(`${d}/`));
}

function deny(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

export async function requireSessionOrApiToken(req, res, next) {
    const header = req.get('Authorization');
    if (req.cookies?.session || !header) return requireSession(req, res, next);

    const token = parseBearer(header);
    if (!token) return deny(res, 401, 'INVALID_TOKEN', 'Invalid or revoked API token');
    const { rows } = await query('SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = $1', [hashToken(token)]);
    if (rows.length === 0) return deny(res, 401, 'INVALID_TOKEN', 'Invalid or revoked API token');
    if (!READ_METHODS.has(req.method)) return deny(res, 403, 'TOKEN_READ_ONLY', 'API tokens are read-only');
    if (isDeniedPath(req.originalUrl)) return deny(res, 403, 'TOKEN_FORBIDDEN', 'API tokens cannot access this resource');

    const lastUsed = rows[0].last_used_at ? new Date(rows[0].last_used_at).getTime() : 0;
    if (Date.now() - lastUsed >= LAST_USED_THROTTLE_MS) {
        await query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [rows[0].id]);
    }
    req.userId = rows[0].user_id;
    req.apiTokenId = rows[0].id;
    next();
}
