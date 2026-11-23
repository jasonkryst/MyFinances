import { query } from '../db.js';
import { generateToken, hashToken } from './middleware.js';

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

// The returned `id` is the raw token -- callers put it in the client's
// cookie. Only its hash is ever written to the database (see hashToken()
// in middleware.js for why).
//
// `meta` (#683) is what Settings -> Security shows about the session: the
// User-Agent and the truncated client address (sessionMetaFromRequest).
export async function createSession(userId, meta = {}) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await query(
        `INSERT INTO sessions (id, user_id, expires_at, last_seen_at, user_agent, ip_prefix)
         VALUES ($1, $2, $3, now(), $4, $5)`,
        [hashToken(token), userId, expiresAt, meta.userAgent ?? null, meta.ipPrefix ?? null]
    );
    return { id: token, expiresAt };
}

export function destroySession(sessionToken) {
    return query('DELETE FROM sessions WHERE id = $1', [hashToken(sessionToken)]);
}
