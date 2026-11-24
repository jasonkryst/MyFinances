import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { sanitizeParsedState } from '../sanitizers/index.js';
import { runImport, toWireJson } from '../../../src/importCore.js';
import { loadUserState } from '../jobs/loadUserState.js';
import { getPlanSettings } from './planSettings.js';
import { createTransactionStore, serializeQueries, ImportRejection } from '../importStore.js';

// Bulk import (#529): a whole backup, replace or merge, in one request and one
// database transaction. Any rejected record rolls everything back, so the
// account is never left half-imported. The body limit is higher than the
// API's 1 MB default (app.js skips its global parser for this route, and
// nginx.conf has a matching `location = /api/import`).
export const IMPORT_BODY_LIMIT = '25mb';

// Imports per user per minute. Each one is a whole-account write in one
// transaction, so the cap stops a runaway client from monopolising the pool
// while leaving room for the test harness, which imports once per test. It
// runs before the body parser, so a refused request is never parsed.
export const IMPORT_RATE_LIMIT = { windowMs: 60 * 1000, max: 120 };

const importLimiter = rateLimit({
    ...IMPORT_RATE_LIMIT,
    // Every /api request is authenticated by now; one user, one budget.
    keyGenerator: req => `user:${req.userId}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many imports, try again later' } }
});

const router = express.Router();

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function badRequest(res, message, extra = {}) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message, ...extra } });
}

// The user's current state, in the shape the browser holds it, plus the plan
// settings a merge reads.
async function loadExisting(userId, db) {
    const state = await loadUserState(userId, db);
    const plan = await getPlanSettings(userId, db);
    return {
        ...state,
        budgetCategories: plan.budgetCategories,
        retirementTargetDate: plan.retirementTargetDate,
        homePurchasePlan: plan.homePurchasePlan,
        netWorthMilestonesAwarded: plan.netWorthMilestonesAwarded,
    };
}

router.post('/', importLimiter, express.json({ limit: IMPORT_BODY_LIMIT }), async (req, res, next) => {
    const { mode, data, strategy } = isPlainObject(req.body) ? req.body : {};
    if (mode !== 'replace' && mode !== 'merge') {
        return badRequest(res, "mode must be 'replace' or 'merge'");
    }
    if (!isPlainObject(data)) return badRequest(res, 'data must be an object');
    if (strategy !== undefined && strategy !== null && !isPlainObject(strategy)) {
        return badRequest(res, 'strategy must be an object');
    }

    // Never trust the client's copy: sanitize again, then every record still
    // goes through its route's own sanitizer, validity and ownership checks.
    const warnings = [];
    // Then through JSON, as a record sent to its own route would arrive.
    const clean = JSON.parse(toWireJson(sanitizeParsedState(data, warnings)));

    const client = await pool.connect();
    let rollbackFailed = false;
    try {
        await client.query('BEGIN');
        // Two imports for one user run one after the other, never interleaved.
        await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [req.userId]);
        const db = serializeQueries(client);
        const existing = mode === 'merge' ? await loadExisting(req.userId, db) : null;
        const result = await runImport({
            mode, data: clean, strategy, existing,
            store: createTransactionStore(db, req.userId),
        });
        await client.query('COMMIT');
        res.json({ warnings: [...warnings, ...result.warnings], skipped: result.skipped });
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            rollbackFailed = true;
            console.error('Import rollback failed:', rollbackErr);
        }
        if (err instanceof ImportRejection) {
            return badRequest(res, err.message, { collection: err.collection, index: err.index });
        }
        next(err);
    } finally {
        // A client whose ROLLBACK failed is destroyed, not returned to the pool.
        client.release(rollbackFailed);
    }
});

export default router;
