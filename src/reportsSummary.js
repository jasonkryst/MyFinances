// Reports page summary tab: cash flow / account balance / net worth roll-up

import {
    formatCurrency,
    escapeHtml,
    getReportDate
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { getSnapshotSeries } from './reportsNetWorth.js';

export function computeReportsSummaryMetrics(app, rangeType, baseDate = getReportDate(app)) {
    const year = baseDate.getFullYear();
    const months = rangeType === 'year' ? Array.from({ length: 12 }, (_, m) => m) : [baseDate.getMonth()];

    let income = 0, bills = 0, expenses = 0, recurring = 0, debtMin = 0, savings = 0;
    for (const m of months) {
        const txs = getLedgerTransactionsForMonth(app, year, m);
        for (const tx of txs) {
            if (tx.type === 'income' || tx.type === 'bonus' || tx.type === 'interest') {
                income += tx.amount;
            } else if (tx.type === 'bill') {
                bills += Math.abs(tx.amount || 0);
            } else if (tx.type === 'expense') {
                expenses += Math.abs(tx.amount || 0);
            } else if (tx.type === 'recurring') {
                if (tx.amount >= 0) income += tx.amount;
                else recurring += Math.abs(tx.amount);
            } else if (tx.type === 'debt') {
                debtMin += Math.abs(tx.amount || 0);
            } else if (tx.type === 'savings') {
                savings += Math.abs(tx.amount || 0);
            }
        }
    }
    const net = income - (bills + expenses + recurring + debtMin + savings);

    const endMonth = rangeType === 'year' ? 11 : baseDate.getMonth();
    const accounts = (app.accounts || []).map(a => {
        const startBalance = Number(a.startingBalance) || 0;
        const endBalance = app.computeAccountBalance(a.id, year, endMonth);
        return {
            id: a.id,
            name: a.name,
            type: a.type,
            startBalance: parseFloat(startBalance.toFixed(2)),
            endBalance: parseFloat(endBalance.toFixed(2)),
            change: parseFloat((endBalance - startBalance).toFixed(2))
        };
    });

    const endMonthKey = `${year}-${String(endMonth + 1).padStart(2, '0')}`;
    const series = getSnapshotSeries(app, 240);
    const endSnapshot = series.find(s => String(s.date).slice(0, 7) === endMonthKey) || null;
    const startSnapshot = rangeType === 'year'
        ? (series.find(s => String(s.date).slice(0, 7).startsWith(`${year}-`)) || null)
        : ([...series].reverse().find(s => String(s.date).slice(0, 7) < endMonthKey) || null);

    const netWorth = endSnapshot ? {
        netWorth: endSnapshot.netWorth,
        totalAssets: endSnapshot.totalAssets,
        totalLiabilities: endSnapshot.totalLiabilities,
        netChange: startSnapshot ? parseFloat((endSnapshot.netWorth - startSnapshot.netWorth).toFixed(2)) : null,
        assetGrowth: startSnapshot ? parseFloat((endSnapshot.totalAssets - startSnapshot.totalAssets).toFixed(2)) : null,
        debtDrop: startSnapshot ? parseFloat((startSnapshot.totalLiabilities - endSnapshot.totalLiabilities).toFixed(2)) : null
    } : null;

    return {
        rangeType,
        periodLabel: rangeType === 'year' ? String(year) : baseDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        cashFlow: {
            income: parseFloat(income.toFixed(2)),
            bills: parseFloat(bills.toFixed(2)),
            expenses: parseFloat(expenses.toFixed(2)),
            recurring: parseFloat(recurring.toFixed(2)),
            debtMin: parseFloat(debtMin.toFixed(2)),
            savings: parseFloat(savings.toFixed(2)),
            net: parseFloat(net.toFixed(2))
        },
        accounts,
        netWorth
    };
}

export function renderReportsSummary(app) {
    const container = document.getElementById('reportsSummary');
    if (!container) return;

    const rangeType = app._reportSummaryRange === 'year' ? 'year' : 'month';
    app._reportSummaryRange = rangeType;
    const metrics = computeReportsSummaryMetrics(app, rangeType);
    const cf = metrics.cashFlow;
    const netCls = cf.net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

    const cashFlowRows = [
        ['Income', cf.income],
        ['Bills', cf.bills],
        ['Expense Budgets', cf.expenses],
        ['Recurring Costs', cf.recurring],
        ['Debt Minimums', cf.debtMin],
        ['Savings Contributions', cf.savings]
    ].map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="text-right">${formatCurrency(value)}</td></tr>`).join('');

    const accountRows = metrics.accounts.length === 0
        ? '<tr><td colspan="3" class="text-center text-muted-secondary">No accounts yet.</td></tr>'
        : metrics.accounts.map(a => `
            <tr>
                <td>${escapeHtml(a.name)}</td>
                <td class="text-right">${formatCurrency(a.startBalance)}</td>
                <td class="text-right">${formatCurrency(a.endBalance)}</td>
                <td class="text-right ${a.change >= 0 ? 'rpt-net--pos' : 'rpt-net--neg'}">${a.change >= 0 ? '+' : ''}${formatCurrency(a.change)}</td>
            </tr>`).join('');

    const netWorthSection = metrics.netWorth ? `
        <h4 class="rpt-section-title">Net Worth</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table">
            <caption class="sr-only">Net worth details for ${escapeHtml(metrics.periodLabel)}</caption>
            <tbody>
                <tr><td>Net Worth</td><td class="text-right">${formatCurrency(metrics.netWorth.netWorth)}</td></tr>
                <tr><td>Total Assets</td><td class="text-right">${formatCurrency(metrics.netWorth.totalAssets)}</td></tr>
                <tr><td>Total Liabilities</td><td class="text-right">${formatCurrency(metrics.netWorth.totalLiabilities)}</td></tr>
                ${metrics.netWorth.netChange !== null ? `<tr><td>Net Change</td><td class="text-right">${formatCurrency(metrics.netWorth.netChange)}</td></tr>` : ''}
                ${metrics.netWorth.debtDrop !== null ? `<tr><td>Debt Reduction</td><td class="text-right">${formatCurrency(metrics.netWorth.debtDrop)}</td></tr>` : ''}
            </tbody>
        </table>
        </div>` : '<p class="rpt-empty-msg">No net worth snapshot recorded for this period yet.</p>';

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>Summary Report — ${escapeHtml(metrics.periodLabel)}</h3>
            <div class="nw-range-buttons" role="group" aria-label="Summary report range">
                <button class="nw-range-btn ${rangeType === 'month' ? 'active' : ''}" data-rpt-summary-range="month" type="button">Monthly</button>
                <button class="nw-range-btn ${rangeType === 'year' ? 'active' : ''}" data-rpt-summary-range="year" type="button">Yearly</button>
            </div>
        </div>
        <h4 class="rpt-section-title">Cash Flow</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table">
            <caption class="sr-only">Cash flow summary for ${escapeHtml(metrics.periodLabel)}</caption>
            <tbody>
                ${cashFlowRows}
                <tr class="${netCls}"><td><strong>Net Remaining</strong></td><td class="text-right"><strong>${formatCurrency(cf.net)}</strong></td></tr>
            </tbody>
        </table>
        </div>
        <h4 class="rpt-section-title">Account Balances</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table">
            <caption class="sr-only">Account balances for ${escapeHtml(metrics.periodLabel)}</caption>
            <thead><tr><th>Account</th><th>Start</th><th>End</th><th>Change</th></tr></thead>
            <tbody>${accountRows}</tbody>
        </table>
        </div>
        ${netWorthSection}`;
}
