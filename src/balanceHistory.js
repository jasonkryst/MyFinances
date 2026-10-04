// Balance & minimum-payment history for debts and Credit Card / Loan accounts.
// Pure logic lives in balanceHistoryCore.js; this module mutates app state and
// syncs to Postgres. Exports stay hoisted function declarations: this module
// is imported by debts.js/accounts.js, which sit in the ui.js/postgresSync.js
// import cycles (see CLAUDE.md "Module import constraints").

import { todayISO } from './utils.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import {
    buildHistoryEntry, upsertHistoryEntry, seedHistoryForDebt, seedHistoryForAccount,
    isHistoryTrackedAccount, entryBelongsTo, sortHistory
} from './balanceHistoryCore.js';

let lastLocalId = 0;

// Monotonic Date.now()-based id so entries created in the same millisecond
// (e.g. seeding an original + current entry) never collide.
function nextLocalId() {
    const now = Date.now();
    lastLocalId = now > lastLocalId ? now : lastLocalId + 1;
    return lastLocalId;
}

function findOwnerRecord(app, owner) {
    return owner.kind === 'debt'
        ? (app.debts || []).find(d => Number(d.id) === Number(owner.id))
        : (app.accounts || []).find(a => Number(a.id) === Number(owner.id));
}

export async function recordBalanceHistory(app, owner) {
    const record = findOwnerRecord(app, owner);
    if (!record) return null;
    if (owner.kind === 'account' && !isHistoryTrackedAccount(record)) return null;

    const entry = buildHistoryEntry({ kind: owner.kind, id: record.id }, record, todayISO());
    const result = upsertHistoryEntry(app.balanceHistory || [], entry, nextLocalId());
    if (result.action === 'none') return result.target;

    app.balanceHistory = result.entries;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        if (result.action === 'insert') {
            const saved = await pgPost(app, '/api/balance-history', result.target);
            if (saved?.id) result.target.id = saved.id;
        } else {
            pgPatch(app, `/api/balance-history/${result.target.id}`, result.target);
        }
    }
    return result.target;
}

export function getBalanceHistory(app, owner) {
    return sortHistory((app.balanceHistory || []).filter(e => entryBelongsTo(e, owner)));
}

export function deleteBalanceHistoryEntry(app, id) {
    app.balanceHistory = (app.balanceHistory || []).filter(e => e.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/balance-history/${id}`);
}

// Local mirror of the server's ON DELETE CASCADE — no DELETE requests needed.
// Does not save: callers (deleteDebt/deleteAccount) save right after.
export function removeHistoryForOwner(app, owner) {
    app.balanceHistory = (app.balanceHistory || []).filter(e => !entryBelongsTo(e, owner));
}

export async function seedMissingBalanceHistory(app) {
    const today = todayISO();
    const history = app.balanceHistory || [];
    const debtIdsWithHistory = new Set(history.filter(e => e.debtId != null).map(e => Number(e.debtId)));
    const accountIdsWithHistory = new Set(history.filter(e => e.accountId != null).map(e => Number(e.accountId)));

    const seeded = [];
    for (const debt of app.debts || []) {
        if (!debtIdsWithHistory.has(Number(debt.id))) seeded.push(...seedHistoryForDebt(debt, today));
    }
    for (const account of app.accounts || []) {
        if (isHistoryTrackedAccount(account) && !accountIdsWithHistory.has(Number(account.id))) {
            seeded.push(...seedHistoryForAccount(account, today));
        }
    }
    if (seeded.length === 0) return 0;

    const withIds = seeded.map(e => ({ id: nextLocalId(), ...e }));
    app.balanceHistory = [...history, ...withIds];
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        await Promise.all(withIds.map(async entry => {
            const saved = await pgPost(app, '/api/balance-history', entry);
            if (saved?.id) entry.id = saved.id;
        }));
    }
    return withIds.length;
}
