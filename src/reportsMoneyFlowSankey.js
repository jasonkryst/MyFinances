// Reports page: single-month Money Flow Sankey diagram (issue #79)

import { escapeHtml, getReportDate, formatCurrency, renderChartDataTable } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { computeMonthCashFlowTotals } from './reportsCashFlow.js';

const INCOME_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#059669', '#047857', '#065f46'];

const OUTFLOW_GROUPS = [
    { icon: '🧾', color: '#f59e0b', match: tx => tx.type === 'bill', key: tx => tx.category || 'Other' },
    { icon: '💸', color: '#8b5cf6', match: tx => tx.type === 'expense', key: tx => tx.category || 'Other' },
    { icon: '🔄', color: '#06b6d4', match: tx => tx.type === 'recurring' && tx.amount < 0, key: tx => tx.category || 'Other' },
    { icon: '💳', color: '#ef4444', match: tx => tx.type === 'debt', key: tx => tx.name || 'Debt' },
    { icon: '💰', color: '#10b981', match: tx => tx.type === 'savings', key: tx => tx.name || 'Savings' }
];

const ACCOUNT_COLOR = '#2563eb';
const SURPLUS_COLOR = '#10b981';
const SHORTFALL_COLOR = '#ef4444';
const BALANCE_EPSILON = 0.005;

export function computeMoneyFlowSankeyData(app, year, month) {
    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    const totals = computeMonthCashFlowTotals(app, year, month);
    const balancedTotal = Math.max(totals.income, totals.outflow);
    const hasData = totals.income > 0 || totals.outflow > 0;

    const nodes = [];
    const links = [];
    let nodeSeq = 0;
    const nextId = () => `n${nodeSeq++}`;

    const accountId = nextId();
    nodes.push({ id: accountId, label: 'Account', column: 1, amount: balancedTotal, color: ACCOUNT_COLOR });

    const incomeBySource = {};
    for (const tx of monthTxs) {
        const isIncome = tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest' ||
            (tx.type === 'recurring' && tx.amount >= 0);
        if (!isIncome) continue;
        incomeBySource[tx.name] = (incomeBySource[tx.name] || 0) + tx.amount;
    }
    let colorIdx = 0;
    for (const [name, amount] of Object.entries(incomeBySource)) {
        if (amount <= 0) continue;
        const id = nextId();
        const color = INCOME_COLORS[colorIdx % INCOME_COLORS.length];
        colorIdx++;
        nodes.push({ id, label: name, column: 0, amount, color });
        links.push({ sourceId: id, targetId: accountId, amount, color });
    }

    for (const group of OUTFLOW_GROUPS) {
        const grouped = {};
        for (const tx of monthTxs) {
            if (!group.match(tx)) continue;
            const key = group.key(tx);
            grouped[key] = (grouped[key] || 0) + Math.abs(tx.amount || 0);
        }
        for (const [key, amount] of Object.entries(grouped)) {
            if (amount <= 0) continue;
            const id = nextId();
            const label = `${group.icon} ${key}`;
            nodes.push({ id, label, column: 2, amount, color: group.color });
            links.push({ sourceId: accountId, targetId: id, amount, color: group.color });
        }
    }

    const netDiff = totals.income - totals.outflow;
    if (netDiff > BALANCE_EPSILON) {
        const id = nextId();
        nodes.push({ id, label: 'Surplus', column: 2, amount: netDiff, color: SURPLUS_COLOR });
        links.push({ sourceId: accountId, targetId: id, amount: netDiff, color: SURPLUS_COLOR });
    } else if (netDiff < -BALANCE_EPSILON) {
        const id = nextId();
        const amount = Math.abs(netDiff);
        nodes.push({ id, label: 'Shortfall', column: 0, amount, color: SHORTFALL_COLOR });
        links.push({ sourceId: id, targetId: accountId, amount, color: SHORTFALL_COLOR });
    }

    return { nodes, links, hasData };
}
