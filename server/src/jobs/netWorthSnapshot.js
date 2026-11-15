// Monthly net-worth snapshot (#579). For every user, store this month's
// snapshot even if the app is never opened. The per-user autoNwSnapshot setting
// only governs the app's own capture on load; the server job runs for everyone
// (JOBS_ENABLED=false turns it off for the whole server). The values come from the same pure
// code the browser runs (src/netWorthCore.js -> src/projectionCore.js), over
// the same data shape (loadUserState), so a server snapshot equals the one the
// app would have captured. A month that already has a snapshot is skipped
// (the app's own auto-capture applies the same rule), and an existing row for
// the date is never overwritten. Milestones are not awarded here: the app's
// automatic capture skips them too, and they are celebrated in the UI.

import { query } from '../db.js';
import { buildNetWorthSnapshot, hasSnapshotInMonth } from '../../../src/netWorthCore.js';
import { withProjectionCache } from '../../../src/projectionCache.js';
import { sanitizeNetWorthSnapshot } from '../sanitizers/index.js';
import netWorthSnapshotsRouter from '../routes/netWorthSnapshots.js';
import { loadUserState } from './loadUserState.js';
import { monthPeriodKey } from './periods.js';

const { columns: SNAPSHOT_COLUMNS } = netWorthSnapshotsRouter.crudConfig;

// The snapshot `app` would store at `now` (pure; exported for tests).
export function computeServerSnapshot(app, now) {
    return withProjectionCache(app, () => buildNetWorthSnapshot(app, now, 'auto'));
}

// Stores `snapshot` through the route's sanitizer and columns; returns false
// when a row for that date already exists (it is left untouched).
export async function insertSnapshot(userId, snapshot) {
    const clean = sanitizeNetWorthSnapshot(snapshot);
    if (!clean) throw new Error(`snapshot for user ${userId} failed sanitization`);
    const fields = Object.keys(SNAPSHOT_COLUMNS);
    const cols = fields.map(f => SNAPSHOT_COLUMNS[f]);
    const placeholders = fields.map((_, i) => `$${i + 2}`);
    const { rowCount } = await query(
        `INSERT INTO net_worth_snapshots (user_id, ${cols.join(', ')}) VALUES ($1, ${placeholders.join(', ')})
         ON CONFLICT (user_id, date) DO NOTHING`,
        [userId, ...fields.map(f => clean[f])]
    );
    return rowCount === 1;
}

// One user's snapshot for `now`. Returns 'empty' (no accounts and no debts:
// a $0 snapshot would block the app's capture for the month and hide the
// Net Worth report's live point), 'exists', 'captured' or 'raced' (another
// writer stored that date first).
export async function captureSnapshotForUser(userId, now = new Date()) {
    const app = await loadUserState(userId);
    if (!(app.accounts?.length) && !(app.debts?.length)) return 'empty';
    if (hasSnapshotInMonth(app.monthlySnapshots, now)) return 'exists';
    const snapshot = computeServerSnapshot(app, now);
    return (await insertSnapshot(userId, snapshot)) ? 'captured' : 'raced';
}

export const netWorthSnapshotJob = {
    name: 'net-worth-snapshot',
    periodKey: monthPeriodKey,
    async run({ now = new Date(), log = console } = {}) {
        const { rows } = await query('SELECT id FROM users ORDER BY id');
        const counts = { captured: 0, exists: 0, empty: 0, raced: 0, failed: 0 };
        const errors = [];
        // One user's failure must not stop the others; the period is then
        // marked failed and retried, which skips users already captured.
        for (const { id } of rows) {
            try {
                counts[await captureSnapshotForUser(id, now)]++;
            } catch (err) {
                counts.failed++;
                errors.push(`user ${id}: ${err?.message || err}`);
                log.error(`[jobs] net-worth snapshot failed for user ${id}:`, err);
            }
        }
        if (errors.length) throw new Error(`net-worth snapshot failed for ${errors.length} user(s): ${errors.join('; ')}`);
        return counts;
    },
};
