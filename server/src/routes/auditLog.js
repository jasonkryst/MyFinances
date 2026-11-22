// Change log (#580): read and clear the signed-in user's audit rows. Rows are
// written by the generic routers (server/src/audit.js), never through here.
import express from 'express';
import { query } from '../db.js';

export const AUDIT_LIST_LIMIT = 50;
export const AUDIT_MAX_LIST_LIMIT = 200;

// The record types the routers log, so a filter is checked before it reaches SQL.
export const AUDITED_TABLES = [
    'accounts', 'balance_history', 'bills', 'bonuses', 'debts', 'emergency_funds', 'expenses', 'incomes',
    'ledger_amount_overrides', 'ledger_cleared_transactions', 'manual_transactions', 'net_worth_snapshots',
    'persons', 'plan_history', 'plan_settings', 'reconciliations', 'recurring_templates',
    'retirement_snapshots', 'settings', 'sinking_funds', 'transfers'
];

function badRequest(res, message) {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message } });
}

// Parses ?limit, ?before (an audit row id, for paging) and ?table. Returns
// { error } or the clean values.
export function parseAuditQuery(q = {}) {
    let limit = AUDIT_LIST_LIMIT;
    if (q.limit !== undefined) {
        if (!/^\d+$/.test(String(q.limit))) return { error: 'limit must be a positive integer' };
        limit = Math.min(Math.max(Number(q.limit), 1), AUDIT_MAX_LIST_LIMIT);
    }
    let before = null;
    if (q.before !== undefined && q.before !== '') {
        if (!/^\d{1,18}$/.test(String(q.before))) return { error: 'before must be an audit entry id' };
        before = String(q.before);
    }
    let table = null;
    if (q.table !== undefined && q.table !== '' && q.table !== 'all') {
        if (!AUDITED_TABLES.includes(q.table)) return { error: 'unknown table' };
        table = q.table;
    }
    return { limit, before, table };
}

const router = express.Router();

router.get('/', async (req, res, next) => {
    try {
        const parsed = parseAuditQuery(req.query);
        if (parsed.error) return badRequest(res, parsed.error);
        const { limit, before, table } = parsed;
        const values = [req.userId];
        let where = 'user_id = $1';
        if (before) { values.push(before); where += ` AND id < $${values.length}`; }
        if (table) { values.push(table); where += ` AND table_name = $${values.length}`; }
        values.push(limit + 1);
        const { rows } = await query(
            `SELECT id, table_name, row_id, op, before, after, at FROM audit_log
              WHERE ${where} ORDER BY id DESC LIMIT $${values.length}`,
            values
        );
        const hasMore = rows.length > limit;
        res.json({
            entries: rows.slice(0, limit).map(r => ({
                id: Number(r.id),
                table: r.table_name,
                rowId: r.row_id,
                op: r.op,
                before: r.before,
                after: r.after,
                at: r.at
            })),
            hasMore
        });
    } catch (err) {
        next(err);
    }
});

// Clear All Data (src/storage.js) empties the log last, after the wipe's own deletes.
router.delete('/', async (req, res, next) => {
    try {
        await query('DELETE FROM audit_log WHERE user_id = $1', [req.userId]);
        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

export default router;
