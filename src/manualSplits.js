// Split manual transactions (issue #688). Pure and import-free so the server
// jobs and the browser share it.
//
// A manual transaction may carry `splits: [{ category, amount, memo? }]`.
// Convention: every split amount carries the SAME SIGN as the parent `amount`
// (an outflow's splits are all negative, an inflow's all positive), and the
// splits sum exactly to the parent in integer cents. isValidManualTransaction
// (sanitizers.js) enforces it, so a stored record can be trusted.
//
// NEVER read a manual transaction's `category` directly in a report or filter:
// use expandManualSplits(tx), which yields one { category, amount } part per
// split (or the single category for an unsplit record).

export const MANUAL_SPLIT_MIN = 2;
export const MANUAL_SPLIT_MAX = 20;

export function toCents(value) {
    return Math.round(Number(value) * 100);
}

export function hasSplits(tx) {
    return !!tx && Array.isArray(tx.splits) && tx.splits.length > 0;
}

// Signed per-category parts of a ledger/manual transaction. `fallbackCategory`
// is used for a record with no category. Amounts keep the parent's sign.
export function expandManualSplits(tx, fallbackCategory = 'Other') {
    if (!hasSplits(tx)) {
        return [{ category: tx?.category || fallbackCategory, amount: Number(tx?.amount) || 0 }];
    }
    return tx.splits.map(s => ({ category: s.category || fallbackCategory, amount: Number(s.amount) || 0 }));
}

// The distinct categories of a transaction, in split order.
export function transactionCategories(tx, fallbackCategory = 'Other') {
    return [...new Set(expandManualSplits(tx, fallbackCategory).map(p => p.category))];
}

// True when any part of the transaction is in `category`.
export function transactionHasCategory(tx, category, fallbackCategory = 'Other') {
    return transactionCategories(tx, fallbackCategory).includes(category);
}
