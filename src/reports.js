// Reports page logic: month navigation, calendar, charts

import {
    getReportDate
} from './utils.js';
import { renderCashFlowForecast } from './forecast.js';
import { renderReportsSpending } from './spending.js';
import { renderReportsNetWorth } from './reportsNetWorth.js';
import { renderReportsCalendar } from './reportsCalendar.js';
import { renderReportsIncomeExp, renderReportsMoneyFlow } from './reportsCashFlow.js';
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

export function renderReportsPage(app) {
    updateReportMonthNav(app);

    ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart', '_rptOutflowChart', '_rptNetWorthTrendChart', '_rptNetWorthCompositionChart', '_rptForecastChart', '_rptSpendingPieChart', '_rptSpendingBarChart']
        .forEach(k => {
            if (app[k]) {
                app[k].destroy();
                app[k] = null;
            }
        });

    renderReportsCalendar(app);
    renderReportsIncomeExp(app);
    renderReportsMoneyFlow(app);
    renderReportsVariance(app);
    renderReportsNetWorth(app);
    renderCashFlowForecast(app);
    renderReportsSpending(app);
    renderReportsSummary(app);
}
