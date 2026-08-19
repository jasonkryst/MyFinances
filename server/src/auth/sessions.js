import { query } from '../db.js';
import { generateToken, hashToken } from './middleware.js';

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

// The returned `id` is the raw token -- callers put it in the client's
// cookie. Only its hash is ever written to the database (see hashToken()
// in middleware.js for why).
export async function createSession(userId) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expiresAt]);
    return { id: token, expiresAt };
}

export function destroySession(sessionToken) {
    return query('DELETE FROM sessions WHERE id = $1', [hashToken(sessionToken)]);
}
