import { trustProxyHops } from './trustProxy.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import { requireSession, requireCsrf } from './auth/middleware.js';
import { createAuthRouter } from './routes/auth.js';
import accountsRouter from './routes/accounts.js';
import billsRouter from './routes/bills.js';
import expensesRouter from './routes/expenses.js';
import incomesRouter from './routes/incomes.js';
import bonusesRouter from './routes/bonuses.js';
import debtsRouter from './routes/debts.js';
import recurringTemplatesRouter from './routes/recurringTemplates.js';
import emergencyFundsRouter from './routes/emergencyFunds.js';
import sinkingFundsRouter from './routes/sinkingFunds.js';
import reconciliationsRouter from './routes/reconciliations.js';
import planHistoryRouter from './routes/planHistory.js';
import retirementSnapshotsRouter from './routes/retirementSnapshots.js';
import transfersRouter from './routes/transfers.js';
import manualTransactionsRouter from './routes/manualTransactions.js';
import balanceHistoryRouter from './routes/balanceHistory.js';
import netWorthSnapshotsRouter from './routes/netWorthSnapshots.js';
import settingsRouter from './routes/settings.js';
import ledgerOverridesRouter from './routes/ledgerOverrides.js';
import ledgerClearedRouter from './routes/ledgerCleared.js';
import planSettingsRouter from './routes/planSettings.js';
import createNotificationsRouter from './routes/notifications.js';
import personsRouter from './routes/persons.js';
import calendarRouter, { handlePublicCalendar, createCalendarRateLimiter } from './routes/calendar.js';

export function createApp() {
    const app = express();
    // Trust the reverse proxies in front of this service: the bundled nginx
    // (1, the default), plus any proxy in front of it (TRUST_PROXY_HOPS, see
    // trustProxy.js). Without this, express-rate-limit keys off a proxy's IP
    // for every client (docs/audit/database/DATABASE_AUDIT_2026-09-02.md M1),
    // and req.secure/req.protocol ignore the X-Forwarded-Proto header, which
    // auth.js relies on to set the session cookie's Secure flag per request.
    app.set('trust proxy', trustProxyHops());
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

    // Financial data and session responses must never be stored by a cache.
    // The v6.x service worker runtime-caches same-origin GETs, so during the
    // upgrade window it would otherwise keep API bodies. Set here rather than
    // in nginx: a location-level add_header drops the inherited server-level
    // security headers (CSP etc.). /calendar.ics sets its own no-store.
    app.use(['/api', '/auth'], (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    app.use('/auth', createAuthRouter());

    app.get('/health/session-check', requireSession, (req, res) => res.json({ userId: req.userId }));
    app.post('/health/session-check', requireSession, requireCsrf, (req, res) => res.json({ ok: true }));

    const api = express.Router();
    api.use(requireSession, requireCsrf);
    api.use('/accounts', accountsRouter);
    api.use('/bills', billsRouter);
    api.use('/expenses', expensesRouter);
    api.use('/incomes', incomesRouter);
    api.use('/bonuses', bonusesRouter);
    api.use('/debts', debtsRouter);
    api.use('/recurring-templates', recurringTemplatesRouter);
    api.use('/emergency-funds', emergencyFundsRouter);
    api.use('/sinking-funds', sinkingFundsRouter);
    api.use('/reconciliations', reconciliationsRouter);
    api.use('/plan-history', planHistoryRouter);
    api.use('/retirement-snapshots', retirementSnapshotsRouter);
    api.use('/transfers', transfersRouter);
    api.use('/manual-transactions', manualTransactionsRouter);
    api.use('/balance-history', balanceHistoryRouter);
    api.use('/net-worth-snapshots', netWorthSnapshotsRouter);
    api.use('/settings', settingsRouter);
    api.use('/ledger-overrides', ledgerOverridesRouter);
    api.use('/ledger-cleared', ledgerClearedRouter);
    api.use('/persons', personsRouter);
    api.use('/plan-settings', planSettingsRouter);
    api.use('/notifications', createNotificationsRouter());
    api.use('/calendar', calendarRouter);
    app.use('/api', api);

    app.get('/calendar.ics', createCalendarRateLimiter(), handlePublicCalendar);

    app.use((req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });

    app.use(errorHandler);

    return app;
}

// Client errors raised by middleware (malformed JSON, oversize body, ...) carry
// a 4xx status; answer with it instead of a 500 and skip the stack trace.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    const status = err && (Number.isInteger(err.status) ? err.status : err.statusCode);
    if (Number.isInteger(status) && status >= 400 && status <= 499) {
        if (status === 413) {
            return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
        }
        return res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Bad request' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
