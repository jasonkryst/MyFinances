// Reports page logic: month navigation, calendar, charts

import {
    getReportDate
} from './utils.js';
import { renderCashFlowForecast } from './forecast.js';
import { renderReportsSpending } from './spending.js';
import { renderReportsNetWorth } from './reportsNetWorth.js';
import { renderReportsCalendar } from './reportsCalendar.js';
import { renderReportsIncomeExp, renderReportsMoneyFlow, renderReportsCashFlowTrend } from './reportsCashFlow.js';
import { renderMoneyFlowSankey } from './reportsMoneyFlowSankey.js';
import { renderReportsVariance } from './reportsVariance.js';
import { renderReportsSummary } from './reportsSummary.js';

export function prevReportMonth(app) {
    app._reportMonthOffset--;
    updateReportMonthNav(app);
    renderReportsPage(app);
}

export function nextReportMonth(app) {
    app._reportMonthOffset++;
    updateReportMonthNav(app);
    renderReportsPage(app);
}

export function updateReportMonthNav(app) {
    const d = getReportDate(app);
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const el = document.getElementById('rptMonthLabel');
    if (el) el.textContent = label;

    const prevBtn = document.getElementById('rptPrevMonth');
    if (prevBtn) prevBtn.disabled = app._reportMonthOffset <= -24;
}

// Maps each Reports sub-tab to the render function(s) its panel needs.
// Every chart-owning render function destroys its own prior Chart.js
// instance before creating a new one (see reportsNetWorth.js), so
// re-rendering only the active tab -- instead of unconditionally rebuilding
// all 8 sub-panels and 11 Chart.js instances on every tab click, month-nav,
// or range change -- is safe: a currently-hidden tab simply keeps showing
// whatever it last rendered until the user switches to it, at which point
// the tab-click handler (src/ui.js) calls renderReportsPage() again and it
// renders fresh. See docs/audit/performance/PERFORMANCE_AUDIT_2026-09-02.md.
const REPORT_TAB_RENDERERS = {
    calendar: [renderReportsCalendar],
    incomeexp: [renderReportsIncomeExp],
    moneyflow: [renderMoneyFlowSankey, renderReportsMoneyFlow, renderReportsCashFlowTrend],
    variance: [renderReportsVariance],
    networth: [renderReportsNetWorth],
    forecast: [renderCashFlowForecast],
    spending: [renderReportsSpending],
    summary: [renderReportsSummary],
};

export function renderReportsPage(app) {
    updateReportMonthNav(app);

    const activeBtn = document.querySelector('.rpt-tab-btn--active');
    const activeTab = activeBtn?.getAttribute('data-rptab') || 'calendar';
    const renderers = REPORT_TAB_RENDERERS[activeTab] || REPORT_TAB_RENDERERS.calendar;
    for (const render of renderers) render(app);
}
