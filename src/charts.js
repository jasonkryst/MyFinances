// Charts and visualizations

export function renderBalanceChart(app) {
    if (!app.lastPaymentPlan) return;

    const months = [];
    const debtBalances = {};
    const debtNames = [];
    const debtNameSet = new Set();
    const palette = [
        '#2563eb','#dc2626','#059669','#d97706','#7c3aed',
        '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
    ];

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
        months.push(DebtCalculator.getMonthName(monthData.month - 1));
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
                title: { display: true, text: 'Payoff Timeline — Balance per Debt', font: { size: 13 } },
                tooltip: {
                    mode: 'index', intersect: false,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => '$' + v.toLocaleString() },
                    title: { display: true, text: 'Balance ($)' }
                },
                x: { title: { display: true, text: 'Month' } }
            }
        }
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
            labels: ['Principal (Debt)', 'Total Interest'],
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
                title: { display: true, text: 'Total Interest vs. Principal Paid', font: { size: 13 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ctx.parsed)} (${pct}%)`;
                        }
                    }
                }
            }
        }
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
        const monthName = DebtCalculator.getMonthName(monthData.month - 1);
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
                    label: 'Total Paid',
                    data: totalPaid,
                    borderColor: '#2563eb',
                    backgroundColor: '#2563eb20',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'Principal Paid',
                    data: principalPaid,
                    borderColor: '#059669',
                    backgroundColor: '#05966920',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: 'Interest Paid',
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
                            label += new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD'
                            }).format(context.parsed.y);
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
                        text: 'Amount ($)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                }
            }
        }
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
    const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
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
                title: { display: true, text: 'Monthly Payment Distribution', font: { size: 13 } },
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
}

export function renderDebtToIncomeChart(app) {
    const canvas = document.getElementById('debtToIncomeChart');
    if (!canvas) return;

    if (app.debtToIncomeChart) app.debtToIncomeChart.destroy();

    const { monthlyTotal } = app.computeMonthlyIncome();
    const monthlyPayment = parseFloat(document.getElementById('monthlyPayment')?.value) || 0;

    if (monthlyTotal <= 0 || (app.incomes || []).length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#6b7280';
        ctx.font = '13px sans-serif';
        ctx.fillText('Add income sources to see debt-to-income ratio', canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }

    const debtPmt = Math.min(monthlyPayment, monthlyTotal);
    const remaining = Math.max(0, monthlyTotal - debtPmt);

    const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

    app.debtToIncomeChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Debt Payments', 'Remaining Income'],
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
                title: { display: true, text: 'Monthly Debt-to-Income', font: { size: 13 } },
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
}