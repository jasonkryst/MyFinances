import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { verifyPassword } from '../auth/argon2.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { generateToken, requireCsrf } from '../auth/middleware.js';

const SESSION_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
const CSRF_COOKIE_OPTS = { httpOnly: false, secure: true, sameSite: 'strict', path: '/' };

// A factory, not a module-level singleton -- express-rate-limit's default
// MemoryStore is created fresh per call, so each createApp() instance gets
// its own independent rate-limit counter instead of sharing one across
// every app built in the same process (which mattered for tests creating
// more than one app, and would also matter for any future multi-instance
// deployment).
export function createAuthRouter() {
    const authRouter = express.Router();

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        // Brute-force protection should count failed attempts, not
        // legitimate logins -- a real user logging in repeatedly (multiple
        // devices/tabs) shouldn't get locked out.
        skipSuccessfulRequests: true,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } }
    });

    authRouter.post('/login', loginLimiter, async (req, res, next) => {
        try {
            const { email, password } = req.body || {};
            const reject = () => res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
            if (!email || !password) return reject();

            const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
            if (rows.length === 0) return reject();

            const ok = await verifyPassword(rows[0].password_hash, password);
            if (!ok) return reject();

            const session = await createSession(rows[0].id);
            const csrfToken = generateToken();
            res.cookie('session', session.id, { ...SESSION_COOKIE_OPTS, expires: session.expiresAt });
            res.cookie('csrf', csrfToken, { ...CSRF_COOKIE_OPTS, expires: session.expiresAt });
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    authRouter.post('/logout', requireCsrf, async (req, res, next) => {
        try {
            const sessionId = req.cookies?.session;
            if (sessionId) await destroySession(sessionId);
            res.clearCookie('session');
            res.clearCookie('csrf');
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    return authRouter;
}
