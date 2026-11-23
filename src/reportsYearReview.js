// #689: Reports → Year in review. Builds the plain input the pure rules in
// yearReviewCore.js need, then renders the observations: real events first
// ("What happened"), planned flows second ("From your plan"). Loaded lazily
// through loadReportsSubModules(); stores nothing.
import { t, plural, categoryLabel } from './i18n.js';
import { escapeHtml, formatCurrency, formatMonthYear, formatShortDate, dateToISO } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { getNetWorthTrend } from './reportsNetWorth.js';
import {
    buildPeriod, priorPeriodOf, dataFloorIso, computeYearInsights, NET_WORTH_TREND_MONTHS
} from './yearReviewCore.js';

export function buildYearReviewInput(app, year, today = new Date()) {
    const todayIso = dateToISO(today);
    const period = buildPeriod(year, todayIso);
    const priorPeriod = priorPeriodOf(period);
    const floorIso = dataFloorIso({
        balanceHistory: app.balanceHistory,
        snapshots: app.monthlySnapshots,
        manualTransactions: app.manualTransactions,
        reconciliations: app.reconciliations,
        overrides: app.ledgerAmountOverrides,
        cleared: app.ledgerClearedTransactions,
        incomes: app.incomes,
        recurringTemplates: app.recurringTemplates,
        bonuses: app.bonuses
    });
    return {
        period,
        priorPeriod,
        floorIso,
        netWorthPoints: getNetWorthTrend(app, NET_WORTH_TREND_MONTHS)
            .map(p => ({ monthKey: p.monthKey, netWorth: p.netWorth, kind: p.kind })),
        debts: (app.debts || []).map(d => ({ id: d.id, name: d.name, interestRate: d.interestRate })),
        balanceHistory: (app.balanceHistory || []).filter(e => e && e.debtId !== null && e.debtId !== undefined),
        overrides: app.ledgerAmountOverrides || {},
        reconciliations: app.reconciliations || [],
        sinkingFunds: app.sinkingFunds || [],
        incomes: app.incomes || [],
        recurringTemplates: app.recurringTemplates || [],
        monthsTx: period.months.map(m => getLedgerTransactionsForMonth(app, period.year, m)),
        priorMonthsTx: priorPeriod.months.map(m => getLedgerTransactionsForMonth(app, priorPeriod.year, m))
    };
}

function formatVar(v) {
    if (v && typeof v === 'object') {
        if ('$' in v) return formatCurrency(v.$);
        if ('m' in v) return formatMonthYear(`${v.m}-01`);
        if ('d' in v) return formatShortDate(v.d);
        if ('pct' in v) return `${v.pct}%`;
        if ('cat' in v) return categoryLabel(v.cat);
    }
    return String(v ?? '');
}

export function formatInsight(insight) {
    const vars = {};
    for (const [k, v] of Object.entries(insight.vars || {})) vars[k] = formatVar(v);
    return insight.plural ? plural(insight.key, Number(insight.vars.count) || 0, vars) : t(insight.key, vars);
}

function itemHtml(insight) {
    const tag = insight.estimated
        ? `<span class="yr-tag yr-tag--estimated">${escapeHtml(t('yearReview.tagEstimated'))}</span>`
        : '';
    return `<li class="yr-item"><span>${escapeHtml(formatInsight(insight))}</span>${tag}</li>`;
}

export function renderReportsYearReview(app) {
    const container = document.getElementById('reportsYearReview');
    if (!container) return;
    const today = new Date();
    const thisYear = today.getFullYear();
    // The floor year needs only the dated records, not the projections.
    const floorIso = dataFloorIso({
        balanceHistory: app.balanceHistory, snapshots: app.monthlySnapshots,
        manualTransactions: app.manualTransactions, reconciliations: app.reconciliations,
        overrides: app.ledgerAmountOverrides, cleared: app.ledgerClearedTransactions,
        incomes: app.incomes, recurringTemplates: app.recurringTemplates, bonuses: app.bonuses
    });
    const floorYear = floorIso ? Math.min(Number(floorIso.slice(0, 4)), thisYear) : thisYear;
    const year = Math.max(floorYear, Math.min(thisYear, Number(app._yearReviewYear) || thisYear));
    app._yearReviewYear = year;

    const input = buildYearReviewInput(app, year, today);
    const insights = computeYearInsights(input);
    const headline = insights.find(i => i.id === 'netWorthChange');
    const actual = insights.filter(i => i.kind === 'actual' && i !== headline);
    const planned = insights.filter(i => i.kind === 'planned');
    const label = input.period.isYtd ? t('yearReview.yearSoFar', { year }) : String(year);

    const headlineHtml = headline
        ? `<p class="yr-headline" id="yrHeadline"><span>${escapeHtml(formatInsight(headline))}</span>${headline.estimated ? `<span class="yr-tag yr-tag--estimated">${escapeHtml(t('yearReview.tagEstimated'))}</span>` : ''}</p>`
        : '';
    const actualHtml = actual.length
        ? `<section class="yr-section"><h4>${escapeHtml(t('yearReview.whatHappened'))}</h4><ul class="yr-list" id="yrActual">${actual.map(itemHtml).join('')}</ul></section>`
        : '';
    const plannedHtml = planned.length
        ? `<section class="yr-section"><h4><span>${escapeHtml(t('yearReview.fromPlan'))}</span><span class="yr-tag yr-tag--planned">${escapeHtml(t('yearReview.tagPlanned'))}</span></h4><ul class="yr-list" id="yrPlanned">${planned.map(itemHtml).join('')}</ul></section>`
        : '';
    const emptyHtml = insights.length
        ? ''
        : `<div class="yr-empty" id="yrEmpty"><p>${escapeHtml(t('yearReview.empty'))}</p><p class="yr-empty-hint">${escapeHtml(t('yearReview.emptyHint'))}</p></div>`;

    container.innerHTML = `
        <div class="yr-header">
            <button type="button" class="rpt-month-btn" id="yrPrevYear" aria-label="${escapeHtml(t('yearReview.prevYearAria'))}" title="${escapeHtml(t('yearReview.prevYearAria'))}"${year <= floorYear ? ' disabled' : ''}>&#8249;</button>
            <h3 class="yr-year-label" id="yrYearLabel">${escapeHtml(label)}</h3>
            <button type="button" class="rpt-month-btn" id="yrNextYear" aria-label="${escapeHtml(t('yearReview.nextYearAria'))}" title="${escapeHtml(t('yearReview.nextYearAria'))}"${year >= thisYear ? ' disabled' : ''}>&#8250;</button>
        </div>
        ${headlineHtml}${actualHtml}${plannedHtml}${emptyHtml}`;

    // Re-rendering replaces the stepper buttons, so after a step put focus back
    // on the one used (or the other, once it is disabled) and announce the year
    // through the persistent #yrAnnounce region outside the container.
    const prevBtn = document.getElementById('yrPrevYear');
    const nextBtn = document.getElementById('yrNextYear');
    if (app._yearReviewFocus) {
        const wanted = app._yearReviewFocus === 'prev' ? prevBtn : nextBtn;
        const other = app._yearReviewFocus === 'prev' ? nextBtn : prevBtn;
        (wanted && !wanted.disabled ? wanted : other)?.focus();
        const announce = document.getElementById('yrAnnounce');
        if (announce) announce.textContent = label;
        app._yearReviewFocus = null;
    }
    const step = (delta, which) => {
        app._yearReviewYear = year + delta;
        app._yearReviewFocus = which;
        app.renderReportsPage();
    };
    prevBtn?.addEventListener('click', () => step(-1, 'prev'));
    nextBtn?.addEventListener('click', () => step(1, 'next'));
}
