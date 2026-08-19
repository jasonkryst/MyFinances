import { query } from '../db.js';
import { generateToken } from './middleware.js';

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

export async function createSession(userId) {
    const id = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expiresAt]);
    return { id, expiresAt };
}

export function destroySession(sessionId) {
    return query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
