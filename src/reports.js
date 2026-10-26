// Reports page logic: month navigation, calendar, charts

import {
    getReportDate, renderLazyLoadError
} from './utils.js';
import { renderCashFlowForecast } from './forecast.js';
import { renderReportsSpending } from './spending.js';
import { renderReportsNetWorth } from './reportsNetWorth.js';
import { loadReportsSubModules } from './lazyModules.js';

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

// Maps each always-eager Reports sub-tab to the render function(s) its panel
// needs. The other five tabs (calendar, incomeexp, moneyflow, variance,
// summary) are rendered by modules loaded on demand via
// loadReportsSubModules() (issue #278) -- see getLazyReportRenderers() below
// -- since nothing outside reports.js reaches them and they're all behind
// this same single dispatch point.
//
// Every chart-owning render function destroys its own prior Chart.js
// instance before creating a new one (see reportsNetWorth.js), so
// re-rendering only the active tab -- instead of unconditionally rebuilding
// all 8 sub-panels and 11 Chart.js instances on every tab click, month-nav,
// or range change -- is safe: a currently-hidden tab simply keeps showing
// whatever it last rendered until the user switches to it, at which point
// the tab-click handler (src/ui.js) calls renderReportsPage() again and it
// renders fresh. See docs/audit/performance/PERFORMANCE_AUDIT_2026-09-02.md.
const STATIC_REPORT_TAB_RENDERERS = {
    networth: [renderReportsNetWorth],
    forecast: [renderCashFlowForecast],
    spending: [renderReportsSpending],
};

const LAZY_REPORT_TABS = new Set(['calendar', 'incomeexp', 'moneyflow', 'variance', 'summary']);

async function getLazyReportRenderers(tab) {
    const mods = await loadReportsSubModules();
    switch (tab) {
        case 'calendar': return [mods.calendar.renderReportsCalendar];
        case 'incomeexp': return [mods.cashFlow.renderReportsIncomeExp];
        case 'moneyflow': return [mods.sankey.renderMoneyFlowSankey, mods.cashFlow.renderReportsMoneyFlow, mods.cashFlow.renderReportsCashFlowTrend];
        case 'variance': return [mods.variance.renderReportsVariance];
        case 'summary': return [mods.summary.renderReportsSummary];
        default: return [];
    }
}

export async function renderReportsPage(app) {
    updateReportMonthNav(app);

    const activeBtn = document.querySelector('.rpt-tab-btn--active');
    const activeTab = activeBtn?.getAttribute('data-rptab') || 'calendar';

    if (STATIC_REPORT_TAB_RENDERERS[activeTab]) {
        for (const render of STATIC_REPORT_TAB_RENDERERS[activeTab]) render(app);
        return;
    }

    const tab = LAZY_REPORT_TABS.has(activeTab) ? activeTab : 'calendar';
    try {
        const renderers = await getLazyReportRenderers(tab);
        for (const render of renderers) render(app);
    } catch (err) {
        console.error(`Failed to load Reports module for tab "${tab}"`, err);
        renderLazyLoadError(`rptPanel-${tab}`, 'this report');
    }
}
