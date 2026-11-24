// The storage side of bulk import (#529): a `store` for src/importCore.js's
// runImport() that writes through the same sanitize / ownership / audit code
// the per-record routes use (each router's crudConfig), on one transaction
// client, so a rejected record rolls everything back, audit rows included.

import { USER_STATE_COLLECTIONS } from './jobs/loadUserState.js';
import netWorthSnapshotsRouter from './routes/netWorthSnapshots.js';
import settingsRouter from './routes/settings.js';
import ledgerOverridesRouter from './routes/ledgerOverrides.js';
import ledgerClearedRouter from './routes/ledgerCleared.js';
import { patchPlanSettings, addMilestone, deleteMilestones } from './routes/planSettings.js';
import { deletionLayers, RESOURCE_TABLES } from '../../src/resourceDeletion.js';
import { DEFAULT_PLAN_SETTINGS } from '../../src/planSettingsDefaults.js';

// A record (or entry) the matching route would have answered with a 400.
export class ImportRejection extends Error {
    constructor(message, { collection, index = null } = {}) {
        super(message);
        this.name = 'ImportRejection';
        this.collection = collection;
        this.index = index;
    }
}

const KEYED_ROUTERS = {
    ledgerOverride: { router: ledgerOverridesRouter, collection: 'ledgerAmountOverrides' },
    ledgerCleared: { router: ledgerClearedRouter, collection: 'ledgerClearedTransactions' },
    netWorthSnapshot: { router: netWorthSnapshotsRouter, collection: 'monthlySnapshots' },
    setting: { router: settingsRouter, collection: 'settings' },
};

// Every router that owns a table, by table name.
function routersByTable() {
    const map = new Map();
    const all = [...Object.values(USER_STATE_COLLECTIONS), ...Object.values(KEYED_ROUTERS).map(k => k.router)];
    for (const router of all) map.set(router.crudConfig.table, router);
    return map;
}

// node-postgres warns about (and a future major rejects) a query issued while
// another is still running on the same client. loadUserState() fans out with
// Promise.all, so give it a client whose queries run one after another.
export function serializeQueries(client) {
    let tail = Promise.resolve();
    return {
        // Foreign-key ids already proven to belong to the user (see crudRouter.js).
        // Nothing the import does can make an owned row unowned: a replace wipes
        // before it creates, and the cache starts empty.
        ownedIds: new Set(),
        query(text, params) {
            const run = tail.then(() => client.query(text, params));
            tail = run.catch(() => {});
            return run;
        }
    };
}

export function createTransactionStore(db, userId) {
    return {
        // Same wipe as the browser's pgDeleteAll: every collection children
        // first (one audit row per record), the milestones, the alert history
        // and the plan settings back to their defaults. The audit log itself
        // is kept, so an import stays in the change history.
        async deleteAll() {
            const tables = routersByTable();
            for (const layer of deletionLayers()) {
                for (const path of layer) {
                    const router = tables.get(RESOURCE_TABLES[path]);
                    if (!router) throw new Error(`No router for ${path}`);
                    await router.crudConfig.deleteAllForUser(userId, db);
                }
            }
            await deleteMilestones(userId, db);
            await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
            await patchPlanSettings(userId, DEFAULT_PLAN_SETTINGS, db);
        },

        async create(field, record, index) {
            const router = USER_STATE_COLLECTIONS[field];
            if (!router) throw new Error(`Unknown import collection: ${field}`);
            const { row, error } = await router.crudConfig.insertRecord(userId, record, db);
            if (error) throw new ImportRejection(`${field}[${index}]: ${error}`, { collection: field, index });
            return row;
        },

        async putKeyed(kind, key, value) {
            const keyed = KEYED_ROUTERS[kind];
            if (!keyed) throw new Error(`Unknown keyed import kind: ${kind}`);
            const { row, error } = await keyed.router.crudConfig.upsertEntry(userId, key, value, db);
            if (error) throw new ImportRejection(`${keyed.collection}[${key}]: ${error}`, { collection: keyed.collection });
            return row;
        },

        async addMilestone(milestone) {
            const { error } = await addMilestone(userId, milestone, db);
            if (error) throw new ImportRejection(`netWorthMilestonesAwarded: ${error}`, { collection: 'netWorthMilestonesAwarded' });
        },

        async patchPlanSettings(patch) {
            await patchPlanSettings(userId, patch, db);
        },
    };
}
