// Strategy/payment-plan feature module

import {
    formatCurrency,
    formatShortDate,
    formatLongDate,
    escapeHtml,
    formatMonthYear,
    computeMonthlyIncomeForMonth,
    computeMonthlyBonusesForMonth
} from './utils.js';
import { t, plural } from './i18n.js';
import { comparePlanEntries, deltaTone, sortPlanEntries } from './planHistoryCompare.js';

function computeDebtFingerprint(debts) {
    return (debts || [])
        .filter(d => !d.archived)
        .sort((a, b) => a.id - b.id)
        // #681: a promo change makes the saved plan stale too.
        .map(d => `${d.id}|${d.accountBalance}|${d.interestRate}|${d.minimumPayment}|${d.promoRate ?? ''}|${d.promoEndDate ?? ''}|${d.deferredInterest === true}|${d.deferredInterestAccrued || 0}`)
        .join(',');
}

function isPlanStale(app) {
    if (!app.lastPaymentPlan || !app._planFingerprint) return false;
    return computeDebtFingerprint(app.debts) !== app._planFingerprint;
}

function wirePlanStaleBanner(app) {
    const staleWarning = document.getElementById('planStaleWarning');
    if (!staleWarning) return;
    staleWarning.hidden = !isPlanStale(app);
    const staleBtn = document.getElementById('planStaleRecalcBtn');
    if (staleBtn && !staleBtn._wired) {
        staleBtn._wired = true;
        staleBtn.addEventListener('click', () => app.calculatePaymentPlanFromInputs());
    }
}

const PLAN_STRATEGY_KEYS = {
    avalanche: 'strategy.avalanche',
    snowball: 'strategy.snowball',
    'priority-lowest': 'strategy.priorityLowest',
    'priority-highest': 'strategy.priorityHighest'
};

// Stored strategy ids stay as-is; this translates them at render time.
export function strategyLabel(strategy) {
    const key = PLAN_STRATEGY_KEYS[strategy];
    return key ? t(key) : String(strategy ?? '');
}

/**
 * Render the full Results page after a calculation.
 */
export function displayPaymentPlan(app) {
    if (!app.lastPaymentPlan || !app.lastSummary) {
        console.error('displayPaymentPlan: missing data!');
        return;
    }
    app._planDisplayPending = false;
    wirePlanStaleBanner(app);

    // Update summary
    document.getElementById('totalDebtValue').textContent =
        formatCurrency(app.lastSummary.totalDebt);
    document.getElementById('totalInterestValue').textContent =
        formatCurrency(app.lastSummary.totalInterest);
    document.getElementById('timeToPayOffValue').textContent =
        plural('strategy.timeToPayOffValue', app.lastSummary.monthsToPayOff, { date: formatLongDate(app.lastSummary.payOffDate) });

    // Monthly interest cost: sum of all interest charges in month 1
    let monthlyInterestCost = 0;
    if (app.lastPaymentPlan.length > 0) {
        for (const payment of app.lastPaymentPlan[0].payments) {
            monthlyInterestCost += payment.interest || 0;
        }
    }
    const micEl = document.getElementById('monthlyInterestCostValue');
    if (micEl) micEl.textContent = formatCurrency(monthlyInterestCost);

    // Build debt summary table
    app.displayDebtSummary();

    // Strategy comparison + what-if simulator
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
    const strategy = document.getElementById('paymentStrategy').value;
    app.displayInterestComparison(strategy, monthlyPayment);
    app.displayWhatIfSimulator(monthlyPayment, strategy);

    // Build payment schedule table
    app.displayPaymentSchedule();
}

export function suggestMonthlyPayment(app) {
    const now = new Date();
    const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalDebtMin = (app.debts || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalBills = (app.bills || []).reduce((s, b) => s + (b.amount || 0), 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + (e.budgetAmount || 0), 0);
    const suggested = Math.max(0, monthlyTotal - totalBills - totalExpenses - totalDebtMin);
    const input = document.getElementById('monthlyPayment');
    if (input) {
        input.value = suggested > 0 ? suggested.toFixed(2) : '';
        input.dispatchEvent(new Event('input'));
    }
}

export function renderStrategyIncomeWidget(app) {
    wirePlanStaleBanner(app);
    const widget = document.getElementById('strategyIncomeWidget');
    if (!widget) return;
    if (app.incomes.length === 0) { widget.classList.add('hidden'); widget.classList.remove('visible'); return; }

    const now = new Date();
    const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalDebtMin = app.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const pct = monthlyTotal > 0 ? (totalDebtMin / monthlyTotal * 100) : 0;
    const isWarn = pct > 40;

    let ratioHtml = '';
    if (totalDebtMin > 0 && monthlyTotal > 0) {
        ratioHtml = `<div class="strategy-income-ratio${isWarn ? ' strategy-income-ratio--warn' : ''}">
            ${escapeHtml(t(isWarn ? 'strategy.ratioWarn' : 'strategy.ratioOk', { pct: pct.toFixed(1) }))}
        </div>`;
    }

    const totalBills = (app.bills || []).reduce((s, b) => s + b.amount, 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
    const bonusThisMonth = computeMonthlyBonusesForMonth(app.bonuses, now.getFullYear(), now.getMonth());
    const netAfterAll = monthlyTotal - totalDebtMin - totalBills - totalExpenses;

    let netHtml = '';
    if (totalBills > 0 || totalExpenses > 0) {
        const netClass = netAfterAll >= 0 ? 'strategy-net--positive' : 'strategy-net--negative';
        const breakdown = t(bonusThisMonth > 0 ? 'strategy.netBreakdownBonus' : 'strategy.netBreakdown', {
            bills: formatCurrency(totalBills), expenses: formatCurrency(totalExpenses),
            mins: formatCurrency(totalDebtMin), bonus: formatCurrency(bonusThisMonth)
        });
        netHtml = `<div class="strategy-net ${netClass}">
            ${escapeHtml(t('strategy.netAfter', { amount: formatCurrency(netAfterAll) }))}
            <span class="strategy-net-breakdown">${escapeHtml(breakdown)}</span>
        </div>`;
    }

    const bonusChip = bonusThisMonth > 0
        ? `<span class="strategy-bonus-chip">${escapeHtml(t('strategy.bonusChip', { amount: formatCurrency(bonusThisMonth) }))}</span>` : '';

    widget.classList.add('visible'); widget.classList.remove('hidden');
    widget.innerHTML = `
        💰 ${escapeHtml(t('strategy.incomeExpected', { amount: formatCurrency(monthlyTotal) }))} ${bonusChip}
        ${ratioHtml}
        ${netHtml}`;
}

/**
 * Render the read-only Plan History table — one row per previously submitted
 * "Calculate Payment Plan" run, newest first. Purely informational; entries
 * are not editable or reapplyable from this view.
 */
export function renderPlanHistory(app) {
    const body = document.getElementById('planHistoryBody');
    const empty = document.getElementById('planHistoryEmpty');
    const table = document.getElementById('planHistoryTable');
    if (!body) return;

    // Newest first, by when each plan was saved (#312).
    const entries = sortPlanEntries(app.planHistory).reverse();

    if (entries.length === 0) {
        body.innerHTML = '';
        if (table) table.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        renderPlanCompare(app);
        return;
    }

    if (table) table.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    body.innerHTML = entries.map(entry => `
        <tr>
            <td>${escapeHtml(formatShortDate(entry.createdAt))}</td>
            <td>${formatCurrency(entry.monthlyPayment)}</td>
            <td>${escapeHtml(strategyLabel(entry.strategy))}</td>
            <td>${formatCurrency(entry.totalInterest)}</td>
            <td>${escapeHtml(plural('strategy.months', entry.monthsToPayOff))}</td>
            <td>${entry.payoffDate ? escapeHtml(formatShortDate(entry.payoffDate)) : '—'}</td>
        </tr>
    `).join('');
    renderPlanCompare(app);
}

// ── Per-debt comparison of two Plan History entries (#312) ─────────────────

function payoffLabel(iso) {
    if (!iso) return t('strategy.compareNotPaidOff');
    const [y, m] = iso.split('-').map(Number);
    return formatMonthYear(new Date(y, m - 1, 1));
}

function deltaCell(delta, text) {
    const tone = deltaTone(delta);
    if (tone === null) return '<td class="plan-delta">—</td>';
    const arrow = tone === 'better' ? '↓' : tone === 'worse' ? '↑' : '=';
    return `<td class="plan-delta plan-delta--${tone}"><span aria-hidden="true">${arrow}</span> ${escapeHtml(text)}</td>`;
}

function payoffDeltaText(delta) {
    if (delta === null) return '';
    if (delta === 0) return t('strategy.compareSameMonth');
    return delta < 0
        ? plural('strategy.compareMonthsEarlier', -delta)
        : plural('strategy.compareMonthsLater', delta);
}

function interestDeltaText(delta) {
    if (delta === null) return '';
    if (delta === 0) return t('strategy.compareNoChange');
    return t(delta < 0 ? 'strategy.compareLess' : 'strategy.compareMore', { amount: formatCurrency(Math.abs(delta)) });
}

/**
 * Two selects pick any two entries (default: the previous and the latest);
 * the table shows each debt's payoff month and interest in both, with the
 * change from A to B. Entries saved before #312 have no per-debt data.
 */
export function renderPlanCompare(app) {
    const wrap = document.getElementById('planCompare');
    const selA = document.getElementById('planCompareA');
    const selB = document.getElementById('planCompareB');
    const result = document.getElementById('planCompareResult');
    if (!wrap || !selA || !selB || !result) return;

    const entries = sortPlanEntries(app.planHistory);
    if (entries.length < 2) {
        wrap.classList.add('hidden');
        result.innerHTML = '';
        return;
    }
    wrap.classList.remove('hidden');

    const ids = entries.map(e => String(e.id));
    if (!ids.includes(app._planCompareA)) app._planCompareA = ids[ids.length - 2];
    if (!ids.includes(app._planCompareB)) app._planCompareB = ids[ids.length - 1];

    // Newest first, numbered oldest = 1 so same-day plans stay distinct.
    const options = entries.map((e, i) => `<option value="${escapeHtml(String(e.id))}">${escapeHtml(t('strategy.compareOption', {
        n: i + 1,
        date: formatShortDate(e.createdAt),
        strategy: strategyLabel(e.strategy),
        payment: formatCurrency(e.monthlyPayment),
    }))}</option>`).reverse().join('');
    selA.innerHTML = options;
    selB.innerHTML = options;
    selA.value = app._planCompareA;
    selB.value = app._planCompareB;
    selA.onchange = () => { app._planCompareA = selA.value; renderPlanCompare(app); };
    selB.onchange = () => { app._planCompareB = selB.value; renderPlanCompare(app); };

    const indexA = ids.indexOf(app._planCompareA);
    const indexB = ids.indexOf(app._planCompareB);
    if (indexA === indexB) {
        result.innerHTML = `<p class="target-date-desc" id="planCompareSame">${escapeHtml(t('strategy.compareSame'))}</p>`;
        return;
    }
    const cmp = comparePlanEntries(entries[indexA], entries[indexB]);
    if (!cmp) {
        const missing = (entries[indexA].debts || []).length === 0 ? indexA : indexB;
        result.innerHTML = `<p class="target-date-desc" id="planCompareNoData">${escapeHtml(t('strategy.compareNoData', { n: missing + 1 }))}</p>`;
        return;
    }

    const side = (d, render) => (d ? render(d) : escapeHtml(t('strategy.compareNotInPlan')));
    const rows = cmp.rows.map(r => `
        <tr>
            <th scope="row">${escapeHtml(r.name || t('undo.unnamed'))}</th>
            <td>${side(r.a, d => escapeHtml(payoffLabel(d.payoffDate)))}</td>
            <td>${side(r.b, d => escapeHtml(payoffLabel(d.payoffDate)))}</td>
            ${deltaCell(r.payoffDelta, payoffDeltaText(r.payoffDelta))}
            <td>${side(r.a, d => formatCurrency(d.totalInterest))}</td>
            <td>${side(r.b, d => formatCurrency(d.totalInterest))}</td>
            ${deltaCell(r.interestDelta, interestDeltaText(r.interestDelta))}
        </tr>`).join('');
    const totalDelta = Math.round((cmp.totals.interestB - cmp.totals.interestA) * 100) / 100;
    result.innerHTML = `
        <div class="table-wrapper">
            <table class="plan-compare-table" id="planCompareTable">
                <caption class="sr-only">${escapeHtml(t('strategy.compareCaption', { a: indexA + 1, b: indexB + 1 }))}</caption>
                <thead>
                    <tr>
                        <th scope="col">${escapeHtml(t('strategy.compareColDebt'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColPayoffA'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColPayoffB'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColChange'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColInterestA'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColInterestB'))}</th>
                        <th scope="col">${escapeHtml(t('strategy.compareColChange'))}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr>
                        <th scope="row" colspan="4">${escapeHtml(t('strategy.totalInterest'))}</th>
                        <td>${formatCurrency(cmp.totals.interestA)}</td>
                        <td>${formatCurrency(cmp.totals.interestB)}</td>
                        ${deltaCell(totalDelta, interestDeltaText(totalDelta))}
                    </tr>
                </tfoot>
            </table>
        </div>`;
}
