import express from 'express';
import cookieParser from 'cookie-parser';
import { requireSession, requireCsrf } from './auth/middleware.js';

export function createApp() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    app.get('/health/session-check', requireSession, (req, res) => res.json({ userId: req.userId }));
    app.post('/health/session-check', requireSession, requireCsrf, (req, res) => res.json({ ok: true }));

    app.use((req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        console.error(err);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    });

    return app;
}
