// Retirement accounts: history log, projection, and page rendering.

import { computeRetirementProjection } from './retirementCalculator.js';
import { pgPost, pgDelete } from './postgresSync.js';

export function getRetirementAccounts(app) {
    return (app.accounts || []).filter(a => a.type === 'Retirement');
}

export function getSnapshotsForAccount(app, accountId) {
    return (app.retirementSnapshots || [])
        .filter(s => s.accountId === accountId)
        .sort((a, b) => a.date.localeCompare(b.date));
}

export async function addRetirementSnapshot(app, accountId, date, balance, contribution) {
    const snapshot = { id: Date.now(), accountId, date, balance, contribution };
    app.retirementSnapshots.push(snapshot);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/retirement-snapshots', snapshot);
        if (saved?.id) snapshot.id = saved.id;
    }
    app.renderRetirementPage();
}

export function deleteRetirementSnapshot(app, id) {
    app.retirementSnapshots = app.retirementSnapshots.filter(s => s.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/retirement-snapshots/${id}`);
    app.renderRetirementPage();
}

// Projects an account's value at app.retirementTargetDate, assuming the
// account's rateOfReturn compounds monthly and its most recently logged
// contribution (boosted by employerMatchPercent) recurs every month until
// then. Returns null if no target date is set or the account doesn't exist.
export function computeAccountProjection(app, accountId) {
    if (!app.retirementTargetDate) return null;
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const lastContribution = latest ? latest.contribution : 0;
    const employerMultiplier = 1 + (Number(account.employerMatchPercent) || 0) / 100;
    const monthlyContribution = lastContribution * employerMultiplier;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );

    return computeRetirementProjection(currentBalance, monthlyContribution, Number(account.rateOfReturn) || 0, monthsUntilTarget);
}
