// Ledger free-text search (#586). Pure and DOM-free (Jest + Stryker scope).
// The term is view state held in memory only: it is free text and may hold
// payee names, so it is never written to browser storage.

import { transactionCategories } from './manualSplits.js';

// Lower-cased, trimmed term; '' when absent or not a string.
export function normalizeLedgerSearchTerm(term) {
    return typeof term === 'string' ? term.trim().toLowerCase() : '';
}

// Memo lives on the source record, not on ledger rows. Built once per filter
// pass: key `${type}|${sourceId}` -> memo, for one-off transfers and manual
// transactions.
export function buildLedgerMemoLookup(app) {
    const lookup = new Map();
    for (const xfer of app?.transfers || []) {
        if (xfer?.memo) lookup.set(`transfer|${xfer.id}`, String(xfer.memo));
    }
    for (const mt of app?.manualTransactions || []) {
        // #688: split memos are searchable along with the transaction's memo.
        const memo = [mt?.memo, ...(Array.isArray(mt?.splits) ? mt.splits.map(s => s?.memo) : [])].filter(Boolean).join(' ');
        if (memo) lookup.set(`manual|${mt.id}`, memo);
    }
    return lookup;
}

// True when the row's name, category (stored English or its displayed label)
// or memo contains the term. An empty term matches every row. `term` may be
// raw; it is normalized here.
export function matchesLedgerSearch(tx, term, memoLookup, labelFn) {
    const needle = normalizeLedgerSearchTerm(term);
    if (!needle) return true;
    if (!tx) return false;
    const fields = [tx.name];
    // #688: a split transaction is found by any of its split categories.
    for (const category of transactionCategories(tx, '')) {
        if (!category) continue;
        fields.push(category);
        if (typeof labelFn === 'function') fields.push(labelFn(category));
    }
    if (memoLookup && tx.sourceId !== undefined && tx.sourceId !== null) {
        fields.push(memoLookup.get(`${tx.type}|${tx.sourceId}`));
    }
    return fields.some(f => f !== undefined && f !== null && String(f).toLowerCase().includes(needle));
}
