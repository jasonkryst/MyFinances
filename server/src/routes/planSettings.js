import express from 'express';
import { query } from '../db.js';
import { recordJsonSql, auditCteSql } from '../audit.js';
import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, sanitizeHomePurchasePlan, sanitizeBudgetCategories, sanitizeLedgerSettings, sanitizeReconDrafts } from '../sanitizers/index.js';

const router = express.Router();

// What the routes run their SQL on. Bulk import (#529) passes a transaction
// client with the same query() instead.
const poolDb = { query };

const DEFAULT_LEDGER_SETTINGS = { accountFilter: 'all', dateRange: 'all', sortKey: 'date', sortDir: 'desc', clearedFilter: 'all', categoryFilter: 'all', pageSize: 25 };
const DEFAULT_FORECAST_SETTINGS = { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 };

// #580: the plan fields the change log records. Ledger and Forecast filters
// (ledger_settings, forecast_settings) are view state and change on every
// filter click, so a PATCH that only touches them writes no audit row.
// recon_drafts (#587) is unfinished work, not a plan value: not audited either.
// Named, not written inline: resourceDeletion.test.js treats a route that names its table inline as a collection.
const AUDIT_TABLE_NAME = 'plan_settings';
export const AUDITED_PLAN_COLUMNS = {
    strategy: 'strategy',
    monthlyPayment: 'monthly_payment',
    perMonthStimulus: 'per_month_stimulus',
    retirementTargetDate: 'retirement_target_date',
    homePurchasePlan: 'home_purchase_plan',
    budgetCategories: 'budget_categories'
};

function rowToJson(row, milestones) {
    return {
        strategy: row.strategy,
        monthlyPayment: row.monthly_payment === null ? null : Number(row.monthly_payment),
        perMonthStimulus: row.per_month_stimulus.map(Number),
        ledgerSettings: row.ledger_settings,
        forecastSettings: row.forecast_settings,
        retirementTargetDate: row.retirement_target_date || null,
        homePurchasePlan: row.home_purchase_plan || null,
        budgetCategories: row.budget_categories || {},
        reconDrafts: row.recon_drafts || {},
        netWorthMilestonesAwarded: milestones
    };
}

async function getOrCreateRow(userId, db = poolDb) {
    const existing = await db.query('SELECT * FROM plan_settings WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) return existing.rows[0];
    const { rows } = await db.query(
        `INSERT INTO plan_settings (user_id, ledger_settings, forecast_settings)
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, JSON.stringify(DEFAULT_LEDGER_SETTINGS), JSON.stringify(DEFAULT_FORECAST_SETTINGS)]
    );
    return rows[0];
}

// The GET body. `db` is the pool, or a transaction client during a bulk
// import (#529), which reads the plan settings a merge needs.
export async function getPlanSettings(userId, db = poolDb) {
    const row = await getOrCreateRow(userId, db);
    const milestones = await db.query(
        'SELECT milestone FROM net_worth_milestones_awarded WHERE user_id = $1 ORDER BY milestone',
        [userId]
    );
    return rowToJson(row, milestones.rows.map(r => r.milestone));
}

// The PATCH body: sanitizes the fields that were sent, updates them and writes
// the audit row in one statement. Used by the route and by bulk import (#529).
export async function patchPlanSettings(userId, rawBody, db = poolDb) {
    await getOrCreateRow(userId, db);
    const body = rawBody || {};
    const strategy = body.strategy === undefined ? undefined : (normalizeText(body.strategy, 30) || null);
    const monthlyPayment = body.monthlyPayment === undefined ? undefined :
        (body.monthlyPayment === null ? null : sanitizeFiniteNumber(body.monthlyPayment, null, { min: 0 }));
    const perMonthStimulus = Array.isArray(body.perMonthStimulus)
        ? body.perMonthStimulus.map(v => sanitizeFiniteNumber(v, 0, { min: 0 }))
        : undefined;
    const ledgerSettings = body.ledgerSettings === undefined ? undefined : sanitizeLedgerSettings(body.ledgerSettings, 'all');
    const forecastSettings = body.forecastSettings === undefined ? undefined : {
        rangeMonths: [1, 2, 3, 6, 12].includes(sanitizeInteger(body.forecastSettings?.rangeMonths, 1)) ? sanitizeInteger(body.forecastSettings?.rangeMonths, 1) : 1,
        accountId: body.forecastSettings?.accountId === 'total' ? 'total' : (normalizeText(body.forecastSettings?.accountId, 30) || 'total'),
        notableThresholdPct: sanitizeFiniteNumber(body.forecastSettings?.notableThresholdPct, 130, { min: 100, max: 500 })
    };
    const retirementTargetDate = body.retirementTargetDate === undefined ? undefined : sanitizeDateISO(body.retirementTargetDate);
    // Invalid or non-object input sanitizes to null, which clears the plan.
    const homePurchasePlan = body.homePurchasePlan === undefined ? undefined : sanitizeHomePurchasePlan(body.homePurchasePlan);

    // Non-object input sanitizes to {}, which clears all explicit budgets.
    const budgetCategories = body.budgetCategories === undefined ? undefined : sanitizeBudgetCategories(body.budgetCategories);
    // #587: the whole map is replaced; non-object input sanitizes to {}.
    const reconDrafts = body.reconDrafts === undefined ? undefined : sanitizeReconDrafts(body.reconDrafts);

    const sets = [];
    const values = [userId];
    if (strategy !== undefined) { values.push(strategy); sets.push(`strategy = $${values.length}`); }
    if (monthlyPayment !== undefined) { values.push(monthlyPayment); sets.push(`monthly_payment = $${values.length}`); }
    if (perMonthStimulus !== undefined) { values.push(perMonthStimulus); sets.push(`per_month_stimulus = $${values.length}`); }
    if (ledgerSettings !== undefined) { values.push(JSON.stringify(ledgerSettings)); sets.push(`ledger_settings = $${values.length}`); }
    if (forecastSettings !== undefined) { values.push(JSON.stringify(forecastSettings)); sets.push(`forecast_settings = $${values.length}`); }
    if (retirementTargetDate !== undefined) { values.push(retirementTargetDate); sets.push(`retirement_target_date = $${values.length}`); }
    if (homePurchasePlan !== undefined) { values.push(homePurchasePlan === null ? null : JSON.stringify(homePurchasePlan)); sets.push(`home_purchase_plan = $${values.length}`); }
    if (budgetCategories !== undefined) { values.push(JSON.stringify(budgetCategories)); sets.push(`budget_categories = $${values.length}`); }
    if (reconDrafts !== undefined) { values.push(JSON.stringify(reconDrafts)); sets.push(`recon_drafts = $${values.length}`); }

    if (sets.length > 0) {
        await db.query(
            `WITH old AS (
                SELECT * FROM plan_settings WHERE user_id = $1
             ), upd AS (
                UPDATE plan_settings SET ${sets.join(', ')} WHERE user_id = $1 RETURNING *
             ), ${auditCteSql({
                table: AUDIT_TABLE_NAME,
                op: 'update',
                source: 'upd JOIN old ON old.user_id = upd.user_id',
                rowId: `'plan'`,
                before: recordJsonSql('old', AUDITED_PLAN_COLUMNS),
                after: recordJsonSql('upd', AUDITED_PLAN_COLUMNS)
             })}
             SELECT 1 FROM upd`,
            values
        );
    }
    return getPlanSettings(userId, db);
}

// sanitizeInteger()'s {min} clamps rather than rejects (correct for
// user-typed form fields elsewhere in the app), but a milestone is
// posted programmatically at a fixed threshold -- an out-of-range
// value means a client bug, so it should be rejected outright
// instead of silently recorded as 5000. Resolves to { milestone } or { error }.
export async function addMilestone(userId, rawMilestone, db = poolDb) {
    const milestone = Number(rawMilestone);
    if (!Number.isInteger(milestone) || milestone < 5000) {
        return { error: 'milestone must be an integer >= 5000' };
    }
    await db.query(
        'INSERT INTO net_worth_milestones_awarded (user_id, milestone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, milestone]
    );
    return { milestone };
}

// Empties the awarded-milestones list (Clear All Data, and a replace import).
export async function deleteMilestones(userId, db = poolDb) {
    await db.query('DELETE FROM net_worth_milestones_awarded WHERE user_id = $1', [userId]);
}

router.get('/', async (req, res, next) => {
    try {
        res.json(await getPlanSettings(req.userId));
    } catch (err) {
        next(err);
    }
});

router.patch('/', async (req, res, next) => {
    try {
        res.json(await patchPlanSettings(req.userId, req.body));
    } catch (err) {
        next(err);
    }
});


router.delete('/milestones', async (req, res, next) => {
    try {
        await deleteMilestones(req.userId);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

router.post('/milestones', async (req, res, next) => {
    try {
        const { milestone, error } = await addMilestone(req.userId, req.body?.milestone);
        if (error) {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: error } });
        }
        res.status(201).json({ milestone });
    } catch (err) {
        next(err);
    }
});

export default router;
