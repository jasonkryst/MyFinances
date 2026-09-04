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
import netWorthSnapshotsRouter from './routes/netWorthSnapshots.js';
import settingsRouter from './routes/settings.js';
import ledgerOverridesRouter from './routes/ledgerOverrides.js';
import ledgerClearedRouter from './routes/ledgerCleared.js';
import planSettingsRouter from './routes/planSettings.js';
import createNotificationsRouter from './routes/notifications.js';

export function createApp() {
    const app = express();
    // Trust exactly one hop (nginx.conf is the only proxy in front of this
    // service). Without this, express-rate-limit keys off nginx's container
    // IP for every client (see docs/audit/database/DATABASE_AUDIT_2026-09-02.md
    // M1), and req.secure/req.protocol ignore the X-Forwarded-Proto header
    // nginx sets, which auth.js now relies on to set the session cookie's
    // Secure flag per-request instead of via a static NODE_ENV check.
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());

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
    api.use('/net-worth-snapshots', netWorthSnapshotsRouter);
    api.use('/settings', settingsRouter);
    api.use('/ledger-overrides', ledgerOverridesRouter);
    api.use('/ledger-cleared', ledgerClearedRouter);
    api.use('/plan-settings', planSettingsRouter);
    api.use('/notifications', createNotificationsRouter());
    app.use('/api', api);

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
