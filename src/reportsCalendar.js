// Reports page: calendar grid and day-detail modal

import {
    formatCurrency,
    escapeHtml,
    getReportDate
} from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';

export function renderReportsCalendar(app) {
    const container = document.getElementById('reportsCalendar');
    if (!container) return;
    container.innerHTML = '';

    const rptDate = getReportDate(app);
    const year = rptDate.getFullYear();
    const month = rptDate.getMonth();
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const today = isCurrentMonth ? now.getDate() : -1;

    const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const monthTxs = getLedgerTransactionsForMonth(app, year, month);
    const dayIncome = {};
    const dayBills = {};
    const dayExpenses = {};
    const dayDebts = {};
    const dayBonuses = {};
    const dayRecurring = {};

    const palette = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#6366f1'];
    const debtColorByName = {};
    let ci = 0;

    for (const tx of monthTxs) {
        const day = new Date(tx.date).getDate();
        if (tx.type === 'income' || tx.type === 'interest') {
            if (!dayIncome[day]) dayIncome[day] = [];
            dayIncome[day].push(tx);
            continue;
        }
        if (tx.type === 'bonus') {
            if (!dayBonuses[day]) dayBonuses[day] = [];
            dayBonuses[day].push(tx);
            continue;
        }
        if (tx.type === 'bill') {
            if (!dayBills[day]) dayBills[day] = [];
            dayBills[day].push(tx);
            continue;
        }
        if (tx.type === 'expense') {
            if (!dayExpenses[day]) dayExpenses[day] = [];
            dayExpenses[day].push(tx);
            continue;
        }
        if (tx.type === 'recurring') {
            if (!dayRecurring[day]) dayRecurring[day] = [];
            dayRecurring[day].push(tx);
            continue;
        }
        if (tx.type === 'debt') {
            if (!dayDebts[day]) dayDebts[day] = [];
            if (!debtColorByName[tx.name]) {
                debtColorByName[tx.name] = palette[ci++ % palette.length];
            }
            dayDebts[day].push({ ...tx, _color: debtColorByName[tx.name] });
        }
    }

    const legendItems = [
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--income"></span>Payday</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bill"></span>Bill due</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--expense"></span>Expense</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--recurring"></span>Recurring</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--debt"></span>Debt payment</span>',
        '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bonus"></span>Bonus/Windfall</span>',
        isCurrentMonth ? '<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--today"></span>Today</span>' : ''
    ].filter(Boolean);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let gridHTML = '<div class="rpt-cal-day-labels">';
    for (const dl of DAY_LABELS) gridHTML += `<div class="rpt-cal-day-label">${dl}</div>`;
    gridHTML += '</div><div class="rpt-cal-grid">';

    for (let i = 0; i < firstDay; i++) {
        gridHTML += '<div class="rpt-cal-cell rpt-cal-empty"></div>';
    }

    // Day cells render only a compact count of dots — full event details
    // (name, amount, icon) are shown in the day modal on click, since the
    // inline chips this used to render don't fit at any width without
    // wrapping or clipping. Data needed to render the modal is kept here
    // rather than re-derived on click.
    const dayDataMap = {};

    for (let day = 1; day <= daysInMonth; day++) {
        const incomes = dayIncome[day] || [];
        const bills = dayBills[day] || [];
        const expenses = dayExpenses[day] || [];
        const recurring = dayRecurring[day] || [];
        const debts = dayDebts[day] || [];
        const bonuses = dayBonuses[day] || [];
        const hasEvts = incomes.length || bills.length || expenses.length || recurring.length || debts.length || bonuses.length;
        const isToday = day === today;

        if (hasEvts) {
            dayDataMap[day] = { incomes, bills, expenses, recurring, debts, bonuses };
        }

        const dotTypes = [
            incomes.length && 'income',
            bills.length && 'bill',
            expenses.length && 'expense',
            recurring.length && 'recurring',
            debts.length && 'debt',
            bonuses.length && 'bonus'
        ].filter(Boolean);
        const eventCount = incomes.length + bills.length + expenses.length + recurring.length + debts.length + bonuses.length;

        const dotsHTML = dotTypes.map(t => `<span class="rpt-cal-dot rpt-cal-dot--${t}"></span>`).join('');
        const clickableAttrs = hasEvts ? ` data-cal-day="${day}" tabindex="0" role="button" aria-label="${eventCount} event${eventCount === 1 ? '' : 's'} on ${escapeHtml(monthLabel)} ${day}"` : '';

        gridHTML += `<div class="rpt-cal-cell${hasEvts ? ' rpt-cal-has-events' : ''}${isToday ? ' rpt-cal-today' : ''}"${clickableAttrs}>
            <span class="rpt-cal-day-num">${day}</span>
            ${hasEvts ? `<span class="rpt-cal-dots">${dotsHTML}</span><span class="rpt-cal-count">${eventCount}</span>` : ''}
        </div>`;
    }

    gridHTML += '</div>';

    container.innerHTML = `<h3 class="rpt-cal-month-title">${monthLabel}</h3><div class="rpt-cal-legend">${legendItems.join('')}</div>${gridHTML}`;

    app._reportsCalendarDayData = { monthLabel, dayDataMap };

    const openDay = (day) => openCalendarDayModal(app, day);
    container.querySelectorAll('[data-cal-day]').forEach(el => {
        el.addEventListener('click', () => openDay(Number(el.dataset.calDay)));
        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDay(Number(el.dataset.calDay));
            }
        });
    });
}

/**
 * Render the full event list for one calendar day into the day-detail modal.
 */
export function openCalendarDayModal(app, day) {
    const modal = document.getElementById('calendarDayModal');
    const titleEl = document.getElementById('calendarDayModalTitle');
    const bodyEl = document.getElementById('calendarDayModalBody');
    const closeBtn = document.getElementById('calendarDayModalCloseBtn');
    const data = app._reportsCalendarDayData;
    if (!modal || !titleEl || !bodyEl || !closeBtn || !data || !data.dayDataMap[day]) return;

    const { incomes, bills, expenses, recurring, debts, bonuses } = data.dayDataMap[day];
    titleEl.textContent = `${data.monthLabel} ${day}`;

    let html = '';
    for (const inc of incomes) {
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--income"><span class="rpt-cal-evt-name">💰 ${escapeHtml(inc.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(inc.amount)}</span></div>`;
    }
    for (const bill of bills) {
        const amount = Math.abs(bill.amount || 0);
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--bill"><span class="rpt-cal-evt-name">🧾 ${escapeHtml(bill.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
    }
    for (const exp of expenses) {
        const amount = Math.abs(exp.amount || 0);
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--expense"><span class="rpt-cal-evt-name">🛒 ${escapeHtml(exp.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
    }
    for (const rec of recurring) {
        const amount = Math.abs(rec.amount || 0);
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--recurring"><span class="rpt-cal-evt-name">🔄 ${escapeHtml(rec.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(amount)}</span></div>`;
    }
    for (const debt of debts) {
        const amount = Math.abs(debt.amount || 0);
        const debtColor = debt._color ? debt._color.replace(/'/g, '') : '#2563eb';
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--debt-dynamic" data-debt-color="${debtColor}"><span class="rpt-cal-evt-name">💳 ${escapeHtml(debt.name)}</span><span class="rpt-cal-evt-amt">min ${formatCurrency(amount)}</span></div>`;
    }
    for (const b of bonuses) {
        html += `<div class="rpt-cal-modal-evt rpt-cal-evt--bonus"><span class="rpt-cal-evt-name">🎁 ${escapeHtml(b.name)}</span><span class="rpt-cal-evt-amt">${formatCurrency(b.amount)}</span></div>`;
    }
    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll('[data-debt-color]').forEach(el =>
        el.style.setProperty('--debt-color', el.dataset.debtColor));

    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
    };
    closeBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => closeBtn.focus(), 30);
}
