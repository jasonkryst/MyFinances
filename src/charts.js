// Charts and visualizations
import { computeMonthlyIncomeForMonth, formatCurrency, formatMonthYear, formatPlanMonth, renderChartDataTable } from './utils.js';
import { t } from './i18n.js';

// Shared per-debt color assignment for every chart on the Plan page's
// Chart View tab, so the same debt always gets the same color across
// renderBalanceChart, renderPayoffGanttChart, etc.
export const PLAN_CHART_PALETTE = [
    '#2563eb','#dc2626','#059669','#d97706','#7c3aed',
    '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
];

export function renderBalanceChart(app) {
    if (!app.lastPaymentPlan) return;

    const months = [];
    const debtBalances = {};
    const debtNames = [];
    const debtNameSet = new Set();
    const palette = PLAN_CHART_PALETTE;

    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtNameSet.has(payment.debtName)) {
                debtNames.push(payment.debtName);
                debtNameSet.add(payment.debtName);
                debtBalances[payment.debtName] = [];
            }
        }
    }

    for (const monthData of app.lastPaymentPlan) {
        months.push(formatPlanMonth(monthData.month - 1));
        const paymentMap = {};
        for (const payment of monthData.payments) {
            paymentMap[payment.debtName] = payment.balance;
        }
        for (const name of debtNames) {
            debtBalances[name].push(paymentMap[name] !== undefined ? paymentMap[name] : 0);
        }
    }

    const datasets = debtNames.map((name, i) => ({
        label: name,
        data: debtBalances[name],
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + '22',
        fill: false,
        tension: 0.4,
        pointRadius: 1,
        pointHoverRadius: 4,
    }));

    const ctx = document.getElementById('balanceChart').getContext('2d');
    if (app.balanceChart) app.balanceChart.destroy();
    app.balanceChart = new Chart(ctx, {
        type: 'line',
        data: { labels: months, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                title: { display: true, text: t('strategy.chartBalanceTitle'), font: { size: 13 } },
                tooltip: {
                    mode: 'index', intersect: false,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => '$' + v.toLocaleString() },
                    title: { display: true, text: t('strategy.chartBalanceAxis') }
                },
                x: { title: { display: true, text: t('strategy.chartMonthAxis') } }
            }
        }
    });

    renderChartDataTable('balanceChart', {
        caption: t('strategy.chartBalanceCaption'),
        columns: [t('strategy.colMonth'), ...debtNames],
        rows: months.map((m, i) => [m, ...debtNames.map(name => formatCurrency(debtBalances[name][i]))])
    });
}

// #314: horizontal-bar Gantt view — every debt in app.lastPaymentPlan starts
// being paid in month 1 (the engine applies a minimum payment to every
// non-paid-off debt every month), so each bar is a plain span from 0 to its
// own payoff month — no floating/offset bar syntax needed.
export function renderPayoffGanttChart(app) {
    if (!app.lastPaymentPlan || app.lastPaymentPlan.length === 0) return;
    const canvas = document.getElementById('payoffGanttChart');
    if (!canvas) return;

    const palette = PLAN_CHART_PALETTE;
    const plan = app.lastPaymentPlan;

    // Last month index (1-based `month`) each debt appears in the plan is
    // its payoff month — once paid off, a debt stops appearing in later
    // months' `payments` arrays. Same convention strategyScheduleTable.js
    // already uses to order its columns.
    const payoffMonth = {};
    const totalInterest = {};
    const debtNames = [];
    const debtNameSet = new Set();
    for (const monthData of plan) {
        for (const payment of monthData.payments) {
            if (!debtNameSet.has(payment.debtName)) {
                debtNames.push(payment.debtName);
                debtNameSet.add(payment.debtName);
                totalInterest[payment.debtName] = 0;
            }
            payoffMonth[payment.debtName] = monthData.month;
            totalInterest[payment.debtName] += payment.interest || 0;
        }
    }

    // Soonest-paid-off first, so the bars visually cascade top to bottom.
    debtNames.sort((a, b) => payoffMonth[a] - payoffMonth[b]);

    const monthLabel = (monthNum) => {
        const monthData = plan[monthNum - 1];
        return monthData ? formatMonthYear(monthData.date) : '';
    };

    const colors = debtNames.map((_, i) => palette[i % palette.length]);

    const ctx = canvas.getContext('2d');
    if (app.payoffGanttChart) app.payoffGanttChart.destroy();
    app.payoffGanttChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: debtNames,
            datasets: [{
                label: t('strategy.chartGanttDataset'),
                data: debtNames.map(name => payoffMonth[name]),
                backgroundColor: colors,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: t('strategy.chartGanttTitle'), font: { size: 13 } },
                tooltip: {
                    callbacks: {
                        title: items => items[0]?.label || '',
                        label: ctx => t('strategy.chartGanttPaidOff', { date: monthLabel(payoffMonth[ctx.label]) }),
                        afterLabel: ctx => t('strategy.totalInterestIs', { amount: formatCurrency(totalInterest[ctx.label] || 0) })
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: t('strategy.chartGanttAxis') },
                    ticks: { callback: v => monthLabel(v) }
                },
                y: { title: { display: false } }
            }
        }
    });

    renderChartDataTable('payoffGanttChart', {
        caption: t('strategy.chartGanttCaption'),
        columns: [t('strategy.colDebt'), t('strategy.chartGanttColMonth'), t('strategy.chartGanttColInterest')],
        rows: debtNames.map(name => [name, monthLabel(payoffMonth[name]), formatCurrency(totalInterest[name])])
    });
}

export function renderPieChart(app) {
    const canvas = document.getElementById('pieChart');
    if (!canvas || !app.lastSummary) return;
    const principal = app.lastSummary.totalDebt;
    const interest = app.lastSummary.totalInterest;
    if (app.pieChart) app.pieChart.destroy();
    app.pieChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: [t('strategy.chartPrincipalDebt'), t('strategy.totalInterest')],
            datasets: [{
                data: [parseFloat(principal.toFixed(2)), parseFloat(interest.toFixed(2))],
                backgroundColor: ['#059669', '#dc2626'],
                borderColor: ['#fff', '#fff'],
                borderWidth: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 14, font: { size: 12 } } },
                title: { display: true, text: t('strategy.chartPieTitle'), font: { size: 13 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${formatCurrency(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    renderChartDataTable('pieChart', {
        caption: t('strategy.chartPieCaption'),
        columns: [t('strategy.colCategory'), t('strategy.colAmount')],
        rows: [
            [t('strategy.chartPrincipalDebt'), formatCurrency(principal)],
            [t('strategy.totalInterest'), formatCurrency(interest)]
        ]
    });
}

export function renderProgressChart(app) {
    if (!app.lastPaymentPlan) return;

    const months = [];
    const totalPaid = [];
    const principalPaid = [];
    const interestPaid = [];

    let runningTotal = 0;
    let runningPrincipal = 0;
    let runningInterest = 0;

    for (const monthData of app.lastPaymentPlan) {
        const monthName = formatPlanMonth(monthData.month - 1);
        months.push(monthName);

        let monthPrincipal = 0;
        let monthInterest = 0;
        let monthTotal = 0;
        for (const payment of monthData.payments) {
            monthPrincipal += payment.principal;
            monthInterest += payment.interest;
            monthTotal += payment.payment;
        }
        runningTotal += monthTotal;
        runningPrincipal += monthPrincipal;
        runningInterest += monthInterest;
        totalPaid.push(runningTotal);
        principalPaid.push(runningPrincipal);
        interestPaid.push(runningInterest);
    }

    const ctx = document.getElementById('progressChart').getContext('2d');
    if (app.progressChart) app.progressChart.destroy();
    app.progressChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                {
                    label: t('strategy.chartTotalPaid'),
                    data: totalPaid,
                    borderColor: '#2563eb',
                    backgroundColor: '#2563eb20',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: t('strategy.chartPrincipalPaid'),
                    data: principalPaid,
                    borderColor: '#059669',
                    backgroundColor: '#05966920',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: t('strategy.chartInterestPaid'),
                    data: interestPaid,
                    borderColor: '#dc2626',
                    backgroundColor: '#dc262620',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatCurrency(context.parsed.y);
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    },
                    title: {
                        display: true,
                        text: t('strategy.chartAmountAxis')
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: t('strategy.chartMonthAxis')
                    }
                }
            }
        }
    });

    renderChartDataTable('progressChart', {
        caption: t('strategy.chartProgressCaption'),
        columns: [t('strategy.colMonth'), t('strategy.chartTotalPaid'), t('strategy.chartPrincipalPaid'), t('strategy.chartInterestPaid')],
        rows: months.map((m, i) => [m, formatCurrency(totalPaid[i]), formatCurrency(principalPaid[i]), formatCurrency(interestPaid[i])])
    });
}

export function renderDebtDistributionChart(app) {
    const canvas = document.getElementById('debtDistributionChart');
    if (!canvas || !app.debts || app.debts.length === 0) return;

    if (app.debtDistributionChart) app.debtDistributionChart.destroy();

    const palette = [
        '#2563eb','#dc2626','#d97706','#7c3aed',
        '#db2777','#0891b2','#65a30d','#ea580c','#6366f1','#0d9488'
    ];

    let labels, data;
    if (app.lastPaymentPlan && app.lastPaymentPlan.length > 0) {
        const firstMonth = app.lastPaymentPlan[0];
        labels = [];
        data = [];
        for (const p of firstMonth.payments) {
            if (p.payment > 0) {
                labels.push(p.debtName);
                data.push(parseFloat(p.payment.toFixed(2)));
            }
        }
    } else {
        labels = app.debts.map(d => d.name);
        data = app.debts.map(d => parseFloat((d.minimumPayment || 0).toFixed(2)));
    }

    if (data.length === 0) return;

    const colors = labels.map((_, i) => palette[i % palette.length]);
    const fmt = v => formatCurrency(v);
    const total = data.reduce((a, b) => a + b, 0);

    app.debtDistributionChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: '#fff',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                title: { display: true, text: t('strategy.chartDistTitle'), font: { size: 13 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    renderChartDataTable('debtDistributionChart', {
        caption: t('strategy.chartDistCaption'),
        columns: [t('strategy.colDebt'), t('strategy.chartDistCol')],
        rows: labels.map((l, i) => [l, fmt(data[i])])
    });
}

export function renderDebtToIncomeChart(app) {
    const canvas = document.getElementById('debtToIncomeChart');
    if (!canvas) return;

    if (app.debtToIncomeChart) app.debtToIncomeChart.destroy();

        const now = new Date();
        const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment')?.value) || 0;

    if (monthlyTotal <= 0 || (app.incomes || []).length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#6b7280';
        ctx.font = '13px sans-serif';
        ctx.fillText(t('strategy.chartDtiEmpty'), canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }

    const debtPmt = Math.min(monthlyPayment, monthlyTotal);
    const remaining = Math.max(0, monthlyTotal - debtPmt);

    const fmt = v => formatCurrency(v);

    app.debtToIncomeChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels: [t('strategy.chartDebtPayments'), t('strategy.chartRemainingIncome')],
            datasets: [{
                data: [parseFloat(debtPmt.toFixed(2)), parseFloat(remaining.toFixed(2))],
                backgroundColor: ['#dc2626', '#059669'],
                borderColor: '#fff',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                title: { display: true, text: t('strategy.chartDtiTitle'), font: { size: 13 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    renderChartDataTable('debtToIncomeChart', {
        caption: t('strategy.chartDtiCaption'),
        columns: [t('strategy.colCategory'), t('strategy.colAmount')],
        rows: [
            [t('strategy.chartDebtPayments'), fmt(debtPmt)],
            [t('strategy.chartRemainingIncome'), fmt(remaining)]
        ]
    });
}