// Debt summary table + amortization modal feature module

import {
    formatCurrency,
    getDayOrdinal,
    computeInterestPaidToDate,
    escapeHtml,
    formatMonthYear
} from './utils.js';
import { computeBreakEven } from './breakEven.js';

function renderDebtSummaryTable(app) {
    const summaryBody = document.getElementById('debtSummaryTableBody');
    summaryBody.innerHTML = '';

    const { col, dir } = app._debtSummarySort;

    // Update header sort icons
    document.querySelectorAll('#debtSummaryTable th[data-sort]').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (th.getAttribute('data-sort') === col) {
            icon.textContent = dir === 1 ? '↑' : '↓';
            th.classList.add('sort-active');
        } else {
            icon.textContent = '↕';
            th.classList.remove('sort-active');
        }
    });

    const rows = [...app._debtSummaryRows].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];
        // Treat dates as comparable strings (ISO-like format should sort correctly), nulls last
        if (col === 'payoffDate' || col === 'interestToDate') {
            if (!aVal && !bVal) return 0;
            if (!aVal) return 1;
            if (!bVal) return -1;
            if (col === 'payoffDate') return aVal.localeCompare(bVal) * dir;
            return (aVal - bVal) * dir;
        }
        if (col === 'name') return aVal.localeCompare(bVal) * dir;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return (aVal - bVal) * dir;
    });

    for (const summary of rows) {
        const dueDateStr = summary.dueDate
            ? `<div class="text-sm-muted margin-top-2">Due: ${getDayOrdinal(summary.dueDate)} of month</div>`
            : '';

        // Progress bar: based on originalBalance vs current accountBalance
        const origDebt = app.debts.find(d => d.name === summary.name);
        let progressPct = 0;
        if (summary.isFixedAmount && origDebt) {
            const start = new Date(origDebt.fixedStartDate);
            const end = new Date(origDebt.fixedEndDate);
            const now = new Date();
            const total = end - start;
            const elapsed = Math.max(0, Math.min(now - start, total));
            progressPct = total > 0 ? Math.round(elapsed / total * 100) : 0;
        } else if (origDebt) {
            const origBal = origDebt.originalBalance || origDebt.accountBalance || 0;
            const currBal = origDebt.accountBalance || 0;
            progressPct = origBal > 0 ? Math.min(100, Math.round((origBal - currBal) / origBal * 100)) : 0;
        }
        const progressBar = `
            <div class="summary-progress-wrap">
                <div class="summary-progress-bar">
                    <div class="summary-progress-fill${progressPct >= 100 ? ' summary-progress-fill--complete' : ''}" data-progress-width="${progressPct}"></div>
                </div>
                <div class="summary-progress-label">${progressPct}% paid off</div>
            </div>`;

        const row = document.createElement('tr');
        const iptdCell = summary.interestToDate !== null
            ? `<span class="iptd-value">${formatCurrency(summary.interestToDate)}</span>
               ${summary.debtStartDate ? `<div class="iptd-sub">since ${formatMonthYear(summary.debtStartDate)}</div>` : ''}`
            : '<span class="text-pale">No start date</span>';
        const iSavedCell = summary.interestSaved != null
            ? (summary.interestSaved > 0
                ? `<span class="be-col-saved">${formatCurrency(summary.interestSaved)}</span>`
                : `<span class="be-col-zero">$0.00</span>`)
            : '—';
        const mSavedCell = summary.monthsSaved != null
            ? (summary.monthsSaved > 0
                ? `<span class="be-col-saved">${summary.monthsSaved} mo</span>`
                : `<span class="be-col-zero">0</span>`)
            : '—';
        row.innerHTML = `
            <td>${escapeHtml(summary.name)}${dueDateStr}${progressBar}</td>
            <td class="min-due">${formatCurrency(summary.minDue)}</td>
            <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
            <td class="amount">${formatCurrency(summary.totalPaid)}</td>
            <td class="principal">${formatCurrency(summary.principalPaid)}</td>
            <td class="interest">${formatCurrency(summary.interestPaid)}</td>
            <td>${iptdCell}</td>
            <td>${summary.payoffDate || '-'}</td>
            <td>${iSavedCell}</td>
            <td>${mSavedCell}</td>
            <td><button class="btn btn-small btn-secondary" data-amortization="${escapeHtml(summary.name)}">View</button></td>
        `;
        row.querySelectorAll('[data-progress-width]').forEach(el =>
            el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));
        summaryBody.appendChild(row);
        // Milestone: show confetti if debt was just paid off this render
        if (summary.payoffDate) {
            const today = new Date();
            const payoff = new Date(summary.payoffDate);
            if (
                payoff.getFullYear() === today.getFullYear() &&
                payoff.getMonth() === today.getMonth() &&
                payoff.getDate() === today.getDate()
            ) {
                app.showMilestone(summary.name);
            }
        }
    }

    // Add event listeners for amortization buttons
    document.querySelectorAll('[data-amortization]').forEach(btn => {
        btn.addEventListener('click', () => {
            const debtName = btn.getAttribute('data-amortization');
            app.showAmortizationModal(debtName);
        });
    });
}

/**
 * Build debt summary rows and render the summary table.
 */
export function displayDebtSummary(app) {
    // Get debt names in the order they appear in the payment plan (payment priority order)
    const debtOrderMap = {};
    const debtSummaryMap = {};
    let orderIndex = 0;

    // Map debtName to original debt object for min due and interest rate
    const originalDebts = {};
    for (const debt of app.debts) {
        originalDebts[debt.name] = debt;
    }

    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtSummaryMap[payment.debtName]) {
                debtOrderMap[payment.debtName] = orderIndex++;
                const orig = originalDebts[payment.debtName] || {};
                debtSummaryMap[payment.debtName] = {
                    minDue: orig.minimumPayment || 0,
                    interestRate: orig.interestRate || 0,
                    dueDate: orig.dueDate || null,
                    isFixedAmount: orig.debtType === 'fixedAmount',
                    totalPaid: 0,
                    principalPaid: 0,
                    interestPaid: 0,
                    payoffDate: null,
                    lastPaymentDate: null
                };
            }

            debtSummaryMap[payment.debtName].totalPaid += payment.payment;
            debtSummaryMap[payment.debtName].principalPaid += payment.principal;
            debtSummaryMap[payment.debtName].interestPaid += payment.interest;

            // Build a date using the debt's due day if available, else the 1st of the month
            const summaryEntry = debtSummaryMap[payment.debtName];
            const dueDay = summaryEntry.dueDate;
            const payoffDateWithDueDay = (date) => {
                if (dueDay) {
                    const d = new Date(date.getFullYear(), date.getMonth(), dueDay);
                    return DebtCalculator.formatDate(d);
                }
                return DebtCalculator.formatDate(date);
            };

            // Track last payment date for fixed-amount debts (used as completion date)
            if (summaryEntry.isFixedAmount) {
                summaryEntry.lastPaymentDate = payoffDateWithDueDay(monthData.date);
            }

            if (payment.paidOff) {
                summaryEntry.payoffDate = payoffDateWithDueDay(monthData.date);
            }
        }
    }

    // Store rows as array for sorting: [name, summaryObj, orderIndex]
    app._debtSummaryRows = Object.entries(debtSummaryMap).map(([name, summary]) => {
        const origDebt = originalDebts[name] || {};
        const iptd = computeInterestPaidToDate(origDebt);

        let interestSaved = null;
        let monthsSaved = null;
        if (!summary.isFixedAmount && origDebt.accountBalance > 0) {
            const planPayment = app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === name)?.payment || origDebt.minimumPayment;
            const be = computeBreakEven(origDebt, { minType: 'fixed', planPayment });
            if (be) {
                interestSaved = be.interestSaved;
                monthsSaved = be.monthsSaved;
            }
        }

        return {
            name,
            ...summary,
            payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
            interestToDate: iptd ? iptd.interestPaid : null,
            debtStartDate: origDebt.debtStartDate || null,
            order: debtOrderMap[name],
            interestSaved,
            monthsSaved,
        };
    });
    app._debtSummarySort = app._debtSummarySort || { col: 'order', dir: 1 };

    renderDebtSummaryTable(app);

    // Wire up column header sort clicks (once)
    const table = document.getElementById('debtSummaryTable');
    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const col = th.getAttribute('data-sort');
            if (app._debtSummarySort.col === col) {
                app._debtSummarySort.dir *= -1;
            } else {
                app._debtSummarySort.col = col;
                app._debtSummarySort.dir = 1;
            }
            renderDebtSummaryTable(app);
        };
    });
}

export function showAmortizationModal(app, debtName) {
    const modal = document.getElementById('amortizationModal');
    const title = document.getElementById('amortizationTitle');
    const wrapper = document.getElementById('amortizationTableWrapper');
    if (!modal || !title || !wrapper) return;
    title.textContent = `Amortization Schedule: ${debtName}`;
    let html = '<div class="table-wrapper"><table class="table-full-width"><thead><tr><th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>';
    if (app.lastPaymentPlan) {
        for (let mi = 0; mi < app.lastPaymentPlan.length; mi++) {
            const monthData = app.lastPaymentPlan[mi];
            const payment = monthData.payments.find(p => p.debtName === debtName);
            if (payment) {
                html += `<tr><td>${DebtCalculator.getMonthName(monthData.month - 1)}</td><td>${formatCurrency(payment.payment)}</td><td>${formatCurrency(payment.principal)}</td><td>${formatCurrency(payment.interest)}</td><td>${formatCurrency(payment.balance)}</td></tr>`;
            }
        }
    }
    html += '</tbody></table></div>';
    wrapper.innerHTML = html;
    modal.classList.remove('hidden');
    modal.classList.add('flex-visible');
    document.getElementById('closeAmortization').onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
    };
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
        }
    };
}
