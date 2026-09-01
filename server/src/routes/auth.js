import express from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/argon2.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { generateToken, requireCsrf } from '../auth/middleware.js';

const SECURE = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_OPTS = { httpOnly: true, secure: SECURE, sameSite: 'strict', path: '/' };
const CSRF_COOKIE_OPTS = { httpOnly: false, secure: SECURE, sameSite: 'strict', path: '/' };

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

    const setupStatusLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
    });

    const registerLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } }
    });

    authRouter.get('/setup-status', setupStatusLimiter, async (req, res, next) => {
        try {
            const { rows } = await query('SELECT count(*)::int AS count FROM users');
            res.json({ needsSetup: rows[0].count === 0 });
        } catch (err) {
            next(err);
        }
    });

    // One-shot registration: only works when the users table is empty.
    // Atomic INSERT ... WHERE NOT EXISTS prevents races between a count check
    // and the insert -- if two requests arrive simultaneously only one row is
    // created; the other sees 0 rows returned and gets a 409.
    authRouter.post('/register', registerLimiter, async (req, res, next) => {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Email and password are required' } });
            }
            if (!email.includes('@')) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid email address' } });
            }
            if (password.length < 12) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Password must be at least 12 characters' } });
            }

            const hash = await hashPassword(password);
            const { rows } = await query(
                'INSERT INTO users (email, password_hash) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id',
                [email, hash]
            );
            if (rows.length === 0) {
                return res.status(409).json({ error: { code: 'SETUP_COMPLETE', message: 'Setup is already complete. Please sign in.' } });
            }

            const session = await createSession(rows[0].id);
            const csrfToken = generateToken();
            res.cookie('session', session.id, { ...SESSION_COOKIE_OPTS, expires: session.expiresAt });
            res.cookie('csrf', csrfToken, { ...CSRF_COOKIE_OPTS, expires: session.expiresAt });
            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
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
