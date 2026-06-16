import { getLedgerTransactionsForMonth } from './ledger.js';

export const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'
];

const PINNED_COLORS = { 'Debt Payments': '#ef4444', 'Savings': '#10b981' };

export function categoryColor(name) {
    if (Object.prototype.hasOwnProperty.call(PINNED_COLORS, name)) return PINNED_COLORS[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
}

function _catForTx(tx) {
    if (tx.type === 'bill' || tx.type === 'expense') return tx.category || 'Other';
    if (tx.type === 'recurring' && tx.amount < 0) return tx.category || 'Other';
    if (tx.type === 'debt') return 'Debt Payments';
    if (tx.type === 'savings') return 'Savings';
    return null; // income, bonus, reimbursement — excluded from spending
}

function _aggregate(txs) {
    const m = new Map();
    for (const tx of txs) {
        const cat = _catForTx(tx);
        if (!cat) continue;
        if (!m.has(cat)) m.set(cat, { total: 0, transactions: [] });
        const b = m.get(cat);
        b.total += Math.abs(tx.amount || 0);
        b.transactions.push(tx);
    }
    return m;
}

export function computeSpendingByCategory(app, year, month) {
    const txs = getLedgerTransactionsForMonth(app, year, month);
    const buckets = _aggregate(txs);

    let py = year, pm = month - 1;
    if (pm < 0) { pm = 11; py--; }
    const priorBuckets = _aggregate(getLedgerTransactionsForMonth(app, py, pm));

    const result = [];
    for (const [category, { total, transactions }] of buckets) {
        const prior = priorBuckets.get(category);
        const changeVsLastMonth = (prior && prior.total > 0) ? (total - prior.total) / prior.total : null;
        result.push({ category, total, transactions, changeVsLastMonth });
    }
    result.sort((a, b) => b.total - a.total);
    return result;
}

export function renderReportsSpending(app) {
    const container = document.getElementById('reportsSpending');
    if (!container) return;
    container.innerHTML = '';
}
