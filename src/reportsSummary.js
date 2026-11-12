// Reports page summary tab: cash flow / account balance / net worth roll-up

import {
    formatCurrency,
    escapeHtml,
    getReportDate,
    formatMonthLong
} from './utils.js';
import { t } from './i18n.js';
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
            } else if (tx.type === 'manual') {
                // #584: inflow is income, outflow is an expense.
                if (tx.amount >= 0) income += tx.amount;
                else expenses += Math.abs(tx.amount);
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
        periodLabel: rangeType === 'year' ? String(year) : formatMonthLong(baseDate),
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
        [t('reports.statIncome'), cf.income],
        ...(app.bills?.length > 0 ? [[t('reports.statBills'), cf.bills]] : []),
        [t('reports.statExpenseBudgets'), cf.expenses],
        [t('reports.statRecurringCosts'), cf.recurring],
        [t('reports.statDebtMinimums'), cf.debtMin],
        [t('reports.statSavingsContrib'), cf.savings]
    ].map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="text-right">${formatCurrency(value)}</td></tr>`).join('');

    const accountRows = metrics.accounts.length === 0
        ? `<tr><td colspan="4" class="text-center text-muted-secondary">${escapeHtml(t('reports.sumNoAccounts'))}</td></tr>`
        : metrics.accounts.map(a => `
            <tr>
                <td>${escapeHtml(a.name)}</td>
                <td class="text-right" data-label="${escapeHtml(t('reports.sumStart'))}">${formatCurrency(a.startBalance)}</td>
                <td class="text-right" data-label="${escapeHtml(t('reports.sumEnd'))}">${formatCurrency(a.endBalance)}</td>
                <td class="text-right ${a.change >= 0 ? 'rpt-net--pos' : 'rpt-net--neg'}" data-label="${escapeHtml(t('reports.colChange'))}">${a.change >= 0 ? '+' : ''}${formatCurrency(a.change)}</td>
            </tr>`).join('');

    const netWorthSection = metrics.netWorth ? `
        <h4 class="rpt-section-title">${escapeHtml(t('reports.colNetWorth'))}</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table nw-history-table--compact">
            <caption class="sr-only">${escapeHtml(t('reports.sumNwCaption', { period: metrics.periodLabel }))}</caption>
            <tbody>
                <tr><td>${escapeHtml(t('reports.colNetWorth'))}</td><td class="text-right">${formatCurrency(metrics.netWorth.netWorth)}</td></tr>
                <tr><td>${escapeHtml(t('reports.sumTotalAssets'))}</td><td class="text-right">${formatCurrency(metrics.netWorth.totalAssets)}</td></tr>
                <tr><td>${escapeHtml(t('reports.sumTotalLiabilities'))}</td><td class="text-right">${formatCurrency(metrics.netWorth.totalLiabilities)}</td></tr>
                ${metrics.netWorth.netChange !== null ? `<tr><td>${escapeHtml(t('reports.sumNetChange'))}</td><td class="text-right">${formatCurrency(metrics.netWorth.netChange)}</td></tr>` : ''}
                ${metrics.netWorth.debtDrop !== null ? `<tr><td>${escapeHtml(t('reports.nwDebtReduction'))}</td><td class="text-right">${formatCurrency(metrics.netWorth.debtDrop)}</td></tr>` : ''}
            </tbody>
        </table>
        </div>` : `<p class="rpt-empty-msg">${escapeHtml(t('reports.sumNoSnapshot'))}</p>`;

    container.innerHTML = `
        <div class="nw-report-header">
            <h3>${escapeHtml(t('reports.sumTitle', { period: metrics.periodLabel }))}</h3>
            <div class="nw-range-buttons" role="group" aria-label="${escapeHtml(t('reports.sumRangeAria'))}">
                <button class="nw-range-btn ${rangeType === 'month' ? 'active' : ''}" data-rpt-summary-range="month" type="button" aria-pressed="${rangeType === 'month' ? 'true' : 'false'}">${escapeHtml(t('reports.sumMonthly'))}</button>
                <button class="nw-range-btn ${rangeType === 'year' ? 'active' : ''}" data-rpt-summary-range="year" type="button" aria-pressed="${rangeType === 'year' ? 'true' : 'false'}">${escapeHtml(t('reports.sumYearly'))}</button>
            </div>
        </div>
        <h4 class="rpt-section-title">${escapeHtml(t('reports.sumCashFlow'))}</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table nw-history-table--compact">
            <caption class="sr-only">${escapeHtml(t('reports.sumCfCaption', { period: metrics.periodLabel }))}</caption>
            <tbody>
                ${cashFlowRows}
                <tr class="${netCls}"><td><strong>${escapeHtml(t('reports.statNetRemaining'))}</strong></td><td class="text-right"><strong>${formatCurrency(cf.net)}</strong></td></tr>
            </tbody>
        </table>
        </div>
        <h4 class="rpt-section-title">${escapeHtml(t('reports.sumAccountBalances'))}</h4>
        <div class="nw-history-table-wrap">
        <table class="nw-history-table nw-history-table--compact">
            <caption class="sr-only">${escapeHtml(t('reports.sumAcctCaption', { period: metrics.periodLabel }))}</caption>
            <thead><tr><th>${escapeHtml(t('reports.colAccount'))}</th><th>${escapeHtml(t('reports.sumStart'))}</th><th>${escapeHtml(t('reports.sumEnd'))}</th><th>${escapeHtml(t('reports.colChange'))}</th></tr></thead>
            <tbody>${accountRows}</tbody>
        </table>
        </div>
        ${netWorthSection}`;
}
