import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { query } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/argon2.js';
import { createSession, destroySession } from '../auth/sessions.js';
import { generateToken, requireCsrf } from '../auth/middleware.js';
import { sendTemplatedEmail } from '../email/send.js';

// `secure` is derived per-request from `req.secure` rather than a static
// NODE_ENV flag: with `trust proxy` set (server/src/app.js), Express derives
// req.secure from nginx's X-Forwarded-Proto header, so cookies are Secure
// exactly when the request actually arrived over HTTPS -- correct for local
// HTTP testing (no manual flag needed) and correct the moment HTTPS is
// terminated in front, with no deployment-sequencing gap either way. See
// docs/audit/security/SECURITY_AUDIT_2026-09-02.md's NODE_ENV addendum.
function sessionCookieOpts(req) {
    return { httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/' };
}
function csrfCookieOpts(req) {
    return { httpOnly: false, secure: req.secure, sameSite: 'strict', path: '/' };
}

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
            res.cookie('session', session.id, { ...sessionCookieOpts(req), expires: session.expiresAt });
            res.cookie('csrf', csrfToken, { ...csrfCookieOpts(req), expires: session.expiresAt });

            try {
                await sendTemplatedEmail(email, 'welcomeEmail', { email });
            } catch (err) {
                console.error('[auth] welcome email failed:', err);
            }

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
            res.cookie('session', session.id, { ...sessionCookieOpts(req), expires: session.expiresAt });
            res.cookie('csrf', csrfToken, { ...csrfCookieOpts(req), expires: session.expiresAt });
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

    const forgotPasswordLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } }
    });

    // Always returns 200 to avoid confirming whether the email is registered.
    authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
        try {
            const { email } = req.body || {};
            if (!email) return res.json({ ok: true });

            const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
            if (rows.length === 0) return res.json({ ok: true });

            const token = randomBytes(32).toString('hex');
            const tokenHash = createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            await query(
                'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
                [rows[0].id, tokenHash, expiresAt]
            );

            const origin = `${req.protocol}://${req.get('host')}`;
            const resetUrl = `${origin}/?reset_token=${token}`;
            try {
                await sendTemplatedEmail(email, 'passwordResetEmail', { resetUrl });
            } catch (err) {
                console.error('[auth] password reset email failed:', err);
            }

            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    authRouter.post('/reset-password', async (req, res, next) => {
        try {
            const { token, newPassword } = req.body || {};
            const invalid = () => res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link.' } });

            if (!token || !newPassword) return invalid();
            if (newPassword.length < 12) {
                return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Password must be at least 12 characters.' } });
            }

            const tokenHash = createHash('sha256').update(token).digest('hex');
            const { rows } = await query(
                'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
                [tokenHash]
            );
            if (rows.length === 0) return invalid();

            const newHash = await hashPassword(newPassword);
            await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, rows[0].user_id]);
            await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [rows[0].id]);

            res.json({ ok: true });
        } catch (err) {
            next(err);
        }
    });

    return authRouter;
}
