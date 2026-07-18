// Strategy payment-calendar feature module

import {
    getBillsByDayForMonth,
    getIncomeEventsByMonthForRange,
    formatCurrency,
    escapeHtml
} from './utils.js';

/**
 * Render the payment calendar for a given page (1 month per page).
 */
export function renderCalendarView(app, page = 0) {
    const container = document.getElementById('calendarView');
    if (!container || !app.lastPaymentPlan || app.lastPaymentPlan.length === 0) return;
    container.innerHTML = '';

    const MONTHS_PER_PAGE = 1;

    const debtColors = {};
    // Each color must reach 4.5:1 contrast with the white text in .cal-event (WCAG AA)
    const palette = [
        '#2563eb', '#dc2626', '#b45309', '#7c3aed',
        '#be185d', '#0e7490', '#4d7c0f', '#9a3412', '#4f46e5'
    ];
    let colorIdx = 0;
    for (const debt of app.debts) {
        debtColors[debt.name] = palette[colorIdx++ % palette.length];
    }

    const planStart = app.lastPaymentPlan[0].date;
    const planEnd = app.lastPaymentPlan[app.lastPaymentPlan.length - 1].date;
    const incomeByMonth = getIncomeEventsByMonthForRange(app.incomes || [], planStart, planEnd);

    const monthMap = new Map();
    for (const monthData of app.lastPaymentPlan) {
        const d = monthData.date;
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (!monthMap.has(key)) {
            monthMap.set(key, { year: d.getFullYear(), month: d.getMonth(), payments: [] });
        }
        for (const payment of monthData.payments) {
            if (payment.payment <= 0) continue;
            const orig = app.debts.find(dbt => dbt.name === payment.debtName);
            const dueDay = orig?.dueDate || 1;
            monthMap.get(key).payments.push({
                name: payment.debtName,
                payment: payment.payment,
                dueDay,
                color: debtColors[payment.debtName] || '#2563eb'
            });
        }
    }

    const allMonths = [...monthMap.values()];
    const totalPages = Math.ceil(allMonths.length / MONTHS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageMonths = allMonths.slice(page * MONTHS_PER_PAGE, page * MONTHS_PER_PAGE + MONTHS_PER_PAGE);

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const hasIncome = (app.incomes || []).length > 0;
    const hasBills = (app.bills || []).some(b => b.dueDay);
    const legendDiv = document.createElement('div');
    legendDiv.className = 'cal-legend';
    legendDiv.innerHTML = `
        <span class="cal-legend-item"><span class="cal-legend-swatch bg-blue-debt"></span>Debt payment</span>
        ${hasIncome ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--income"></span>Payday</span>` : ''}
        ${hasBills ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--bill"></span>Bill due</span>` : ''}
        <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--today"></span>Today</span>
    `;
    container.appendChild(legendDiv);

    const paginationTop = document.createElement('div');
    paginationTop.className = 'cal-pagination';
    paginationTop.innerHTML = `
        <button class="btn btn-secondary cal-prev" ${page === 0 ? 'disabled' : ''}>&#8592; Prev</button>
        <span class="cal-page-label">${page * MONTHS_PER_PAGE + 1}–${Math.min((page + 1) * MONTHS_PER_PAGE, allMonths.length)} of ${allMonths.length} months</span>
        <button class="btn btn-secondary cal-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>
    `;
    container.appendChild(paginationTop);

    const monthsRow = document.createElement('div');
    monthsRow.className = 'cal-months-row';

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDay = today.getDate();

    for (const { year, month, payments } of pageMonths) {
        const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const dayPayments = {};
        for (const p of payments) {
            if (!dayPayments[p.dueDay]) dayPayments[p.dueDay] = [];
            dayPayments[p.dueDay].push(p);
        }

        const monthKey = `${year}-${month}`;
        const incomeEvents = incomeByMonth.get(monthKey) || [];
        const dayIncome = {};
        for (const inc of incomeEvents) {
            if (!dayIncome[inc.day]) dayIncome[inc.day] = [];
            dayIncome[inc.day].push(inc);
        }

        const dayBills = getBillsByDayForMonth(app.bills, year, month);

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let gridHTML = `<div class="cal-day-labels">`;
        for (const dl of DAY_LABELS) gridHTML += `<div class="cal-day-label">${dl}</div>`;
        gridHTML += `</div><div class="cal-grid">`;

        for (let i = 0; i < firstDay; i++) {
            gridHTML += `<div class="cal-cell cal-empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const events = dayPayments[day] || [];
            const incomes = dayIncome[day] || [];
            const bills = dayBills[day] || [];
            const hasEvents = events.length > 0 || incomes.length > 0 || bills.length > 0;
            const isToday = (year === todayYear && month === todayMonth && day === todayDay);

            gridHTML += `<div class="cal-cell${hasEvents ? ' cal-has-events' : ''}${isToday ? ' cal-today' : ''}">
                <span class="cal-day-num">${day}</span>`;

            for (const ev of events) {
                gridHTML += `<div class="cal-event" data-event-bg="${ev.color}" title="${escapeHtml(ev.name)}: ${formatCurrency(ev.payment)}">
                    <span class="cal-event-name">${escapeHtml(ev.name)}</span>
                    <span class="cal-event-amount">${formatCurrency(ev.payment)}</span>
                </div>`;
            }

            for (const inc of incomes) {
                gridHTML += `<div class="cal-income-event" title="💰 ${escapeHtml(inc.name)}: ${formatCurrency(inc.amount)}">
                    <span class="cal-income-name">💰 ${escapeHtml(inc.name)}</span>
                    <span class="cal-income-amount">${formatCurrency(inc.amount)}</span>
                </div>`;
            }

            for (const bill of bills) {
                gridHTML += `<div class="cal-bill-event" title="🧾 ${escapeHtml(bill.name)}: ${formatCurrency(bill.amount)}">
                    <span class="cal-bill-name">🧾 ${escapeHtml(bill.name)}</span>
                    <span class="cal-bill-amount">${formatCurrency(bill.amount)}</span>
                </div>`;
            }

            gridHTML += `</div>`;
        }
        gridHTML += `</div>`;

        const monthBlock = document.createElement('div');
        monthBlock.className = 'cal-month';
        monthBlock.innerHTML = `<h4 class="cal-month-title">${monthLabel}</h4>${gridHTML}`;
        monthBlock.querySelectorAll('[data-event-bg]').forEach(el =>
            el.style.setProperty('--event-bg', el.dataset.eventBg));
        monthsRow.appendChild(monthBlock);
    }

    container.appendChild(monthsRow);

    const paginationBottom = paginationTop.cloneNode(true);
    container.appendChild(paginationBottom);

    container.querySelectorAll('.cal-prev').forEach(btn => {
        btn.addEventListener('click', () => app.renderCalendarView(page - 1));
    });
    container.querySelectorAll('.cal-next').forEach(btn => {
        btn.addEventListener('click', () => app.renderCalendarView(page + 1));
    });
}
