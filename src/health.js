import { computeMonthlyIncomeForMonth, formatCurrency, escapeHtml, renderChartDataTable } from './utils.js';
import { t, getIntlLocale } from './i18n.js';
import { buildProjectedAccountTransactions } from './ledgerTransactions.js';
import { getSetting, setSetting, SURPLUS_ACCOUNT_ID, SURPLUS_WINDOW_DAYS, SURPLUS_CUSHION_PCT } from './settings.js';

// Persists allocation slider position across renderSurplusSection re-renders (0–100 = % to debt).
let _surplusDebtPct = 100;

function dtiStatus(ratio) {
    if (ratio < 0.28) return { cls: 'health-status--green', label: t('health.status.healthy') };
    if (ratio < 0.40) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.highRisk') };
}

function savingsStatus(ratio) {
    if (ratio >= 0.20) return { cls: 'health-status--green', label: t('health.status.strong') };
    if (ratio >= 0.10) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.low') };
}

function emergencyStatus(months) {
    if (months >= 6) return { cls: 'health-status--green', label: t('health.status.efExcellent') };
    if (months >= 3) return { cls: 'health-status--green', label: t('health.status.efGood') };
    if (months >= 1) return { cls: 'health-status--yellow', label: t('health.status.efBuilding') };
    return { cls: 'health-status--red', label: t('health.status.efCritical') };
}

function timelineStatus(months) {
    if (months <= 24) return { cls: 'health-status--green', label: t('health.status.onTrack') };
    if (months <= 60) return { cls: 'health-status--yellow', label: t('health.status.longJourney') };
    return { cls: 'health-status--red', label: t('health.status.extended') };
}

function cashFlowStatus(net) {
    if (net > 0) return { cls: 'health-status--green', label: t('health.status.surplus') };
    if (net === 0) return { cls: 'health-status--yellow', label: t('health.status.breakEven') };
    return { cls: 'health-status--red', label: t('health.status.deficit') };
}

function budgetCategoryStatusCls(pct, category) {
    const isHousing = /rent|mortgage|housing/i.test(category);
    if (isHousing) {
        if (pct < 0.28) return 'health-status--green';
        if (pct < 0.36) return 'health-status--yellow';
        return 'health-status--red';
    }
    if (pct < 0.10) return 'health-status--green';
    if (pct < 0.15) return 'health-status--yellow';
    return 'health-status--red';
}

function statusFillCls(statusCls) {
    if (statusCls === 'health-status--green') return 'health-fill--green';
    if (statusCls === 'health-status--yellow') return 'health-fill--yellow';
    if (statusCls === 'health-status--orange') return 'util-fill--orange';
    return 'health-fill--red';
}

function creditUtilizationStatus(pct) {
    if (pct <= 10) return { cls: 'health-status--green',  label: 'Good' };
    if (pct <= 30) return { cls: 'health-status--yellow', label: 'Fair' };
    if (pct <= 50) return { cls: 'health-status--orange', label: 'High' };
    return { cls: 'health-status--red', label: pct >= 100 ? 'Maxed' : 'Critical' };
}

function surplusStatus(surplus) {
    if (surplus > 0)  return { cls: 'health-status--green',  label: 'Surplus' };
    if (surplus === 0) return { cls: 'health-status--yellow', label: 'Break-even' };
    return { cls: 'health-status--red', label: 'Deficit' };
}

function interestBurdenStatus(ratio) {
    if (ratio <= 0.05) return { cls: 'health-status--green',  label: 'Low' };
    if (ratio <= 0.10) return { cls: 'health-status--yellow', label: 'Moderate' };
    return { cls: 'health-status--red', label: 'High' };
}

function debtToAssetStatus(ratio) {
    if (ratio < 0.5) return { cls: 'health-status--green',  label: t('health.status.healthy') };
    if (ratio < 1.0) return { cls: 'health-status--yellow', label: t('health.status.moderate') };
    return { cls: 'health-status--red', label: t('health.status.highRisk') };
}

// Returns an arrow span comparing current vs previous value. higherIsBetter
// controls which direction counts as an improvement. Returns '' when the
// change is negligible (< 0.05 percentage points) to avoid spurious arrows.
function trendArrow(curr, prev, higherIsBetter, { suffix = '%', decimals = 1 } = {}) {
    if (prev === null || prev === undefined || !Number.isFinite(prev) || !Number.isFinite(curr)) return '';
    const delta = curr - prev;
    if (Math.abs(delta) < 0.05) return '';
    const improved = higherIsBetter ? delta > 0 : delta < 0;
    const dir = delta > 0 ? '▲' : '▼';
    const cls = improved ? 'health-trend--good' : 'health-trend--bad';
    const prevFormatted = `${prev.toFixed(decimals)}${suffix}`;
    return `<span class="health-trend ${cls}" title="Last month: ${prevFormatted}">${dir}</span>`;
}

// Walk windowTxs in date order and build a running-balance series plus the
// minimum balance and the date it occurs.
function computeRunningBalance(startBalance, windowTxs) {
    const sorted = [...windowTxs].sort((a, b) => a.date - b.date);
    const points = [{ date: sorted[0]?.date ?? new Date(), balance: startBalance }];
    let bal = startBalance;
    let minBalance = startBalance;
    let minDate = points[0].date;

    for (const tx of sorted) {
        bal += tx.originalAmount;
        if (bal < minBalance) { minBalance = bal; minDate = tx.date; }
        const last = points[points.length - 1];
        if (last.date.getTime() === tx.date.getTime()) {
            last.balance = bal;
        } else {
            points.push({ date: tx.date, balance: bal });
        }
    }
    return { points, minBalance, minDate };
}

// Estimate how many months earlier `debt` would be paid off if `extraPayment`
// were applied as a one-time balance reduction today.
function computeMonthsSaved(debt, extraPayment) {
    if (debt.debtType === 'fixedAmount') return null;
    if (typeof DebtCalculator === 'undefined') return null;
    const bal = debt.accountBalance || 0;
    if (bal <= 0 || extraPayment <= 0) return null;
    const minPmt = Math.max(1, debt.minimumPayment || 1);
    try {
        const base = DebtCalculator.calculatePaymentPlan([{ ...debt }], minPmt, 'avalanche');
        const baseMonths = base.workingDebts[0]?.paidOffMonth ?? null;
        if (baseMonths === null) return null;
        const newBal = Math.max(0, bal - extraPayment);
        if (newBal === 0) return baseMonths;
        const accel = DebtCalculator.calculatePaymentPlan(
            [{ ...debt, accountBalance: newBal }], minPmt, 'avalanche'
        );
        const accelMonths = accel.workingDebts[0]?.paidOffMonth ?? null;
        if (accelMonths === null) return null;
        return Math.max(0, baseMonths - accelMonths);
    } catch (_) { return null; }
}

function computeSurplusAnalysis(app, accountId, windowDays, cushionPct) {
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const monthsNeeded = Math.ceil(windowDays / 28) + 2;

    const accountMap = buildProjectedAccountTransactions(
        app, today.getFullYear(), today.getMonth(), monthsNeeded
    );
    const txs = (accountMap[accountId]?.txs) || [];

    let windowIncome = 0, windowOutflow = 0;
    const windowTxs = [];
    for (const tx of txs) {
        if (tx.date >= today && tx.date <= endDate) {
            windowTxs.push(tx);
            if (tx.originalAmount >= 0) windowIncome  += tx.originalAmount;
            else                        windowOutflow  += Math.abs(tx.originalAmount);
        }
    }

    const netOutflow      = Math.max(0, windowOutflow - windowIncome);
    const cushionAmount   = windowOutflow * (cushionPct / 100);
    const minimumReserve  = netOutflow + cushionAmount;
    const currentBalance  = Number(account.startingBalance) || 0;
    const surplus         = currentBalance - minimumReserve;

    const { points: sparkPoints, minBalance, minDate } =
        windowTxs.length > 0
            ? computeRunningBalance(currentBalance, windowTxs)
            : { points: [{ date: today, balance: currentBalance }, { date: endDate, balance: currentBalance }], minBalance: currentBalance, minDate: today };

    return { account, windowIncome, windowOutflow, netOutflow, cushionAmount, minimumReserve, currentBalance, surplus, windowTxs, sparkPoints, minBalance, minDate };
}

function buildSurplusRecommendations(app, surplus) {
    if (surplus <= 0) return [];
    const recs = [];
    const activeDebts = (app.debts || []).filter(d => !d.archived && debtBal(d) > 0);

    function debtBal(d) {
        return d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
    }

    if (activeDebts.length > 0) {
        const seen = new Set();
        const strategies = [
            ['Highest interest rate', [...activeDebts].sort((a, b) => (b.apr || 0) - (a.apr || 0))[0]],
            ['Highest balance',       [...activeDebts].sort((a, b) => debtBal(b) - debtBal(a))[0]],
            ['Lowest balance (snowball)', [...activeDebts].sort((a, b) => debtBal(a) - debtBal(b))[0]],
        ];
        for (const [label, debt] of strategies) {
            if (debt && !seen.has(debt.id)) {
                seen.add(debt.id);
                const amount = Math.min(surplus, debtBal(debt));
                recs.push({
                    category: 'debt',
                    label,
                    name: debt.name,
                    extra: (debt.apr > 0) ? `${debt.apr}% APR` : '',
                    amount,
                    monthsSaved: computeMonthsSaved(debt, amount),
                });
            }
        }
    }

    const openFunds = [
        ...(app.emergencyFunds || [])
            .filter(f => (f.currentAmount || 0) < (f.targetAmount || 0))
            .map(f => ({ name: f.name || 'Emergency Fund', remaining: f.targetAmount - f.currentAmount, type: 'emergency' })),
        ...(app.sinkingFunds || [])
            .filter(f => (f.currentAmount || 0) < (f.targetAmount || 0))
            .map(f => ({ name: f.name, remaining: f.targetAmount - f.currentAmount, type: 'sinking' })),
    ];
    for (const fund of openFunds.slice(0, 2)) {
        recs.push({
            category: 'savings',
            label: fund.type === 'emergency' ? 'Emergency fund' : 'Savings goal',
            name: fund.name,
            extra: `${formatCurrency(fund.remaining)} remaining`,
            amount: Math.min(surplus, fund.remaining),
        });
    }
    return recs.filter(r => r.amount > 0);
}

function renderSurplusSection(app) {
    const sel        = document.getElementById('healthSurplusAcct');
    const winInput   = document.getElementById('healthSurplusWindow');
    const cushInput  = document.getElementById('healthSurplusCushion');
    const resultDiv  = document.getElementById('healthSurplusResult');
    const badgeEl    = document.getElementById('healthSurplusBadge');
    if (!resultDiv) return;

    const accountId  = parseInt(sel?.value, 10) || null;
    const windowDays = Math.max(7, Math.min(365, parseInt(winInput?.value, 10) || 90));
    const cushionPct = Math.max(0, Math.min(100, parseInt(cushInput?.value, 10) || 20));

    if (!accountId) {
        resultDiv.innerHTML = '<div class="health-empty-state"><span class="health-empty-sub">Select an account to analyze.</span></div>';
        return;
    }

    const analysis = computeSurplusAnalysis(app, accountId, windowDays, cushionPct);
    if (!analysis) {
        resultDiv.innerHTML = '<div class="health-empty-state"><span class="health-empty-sub">Account not found.</span></div>';
        return;
    }

    const { currentBalance, windowIncome, windowOutflow, cushionAmount, minimumReserve, surplus,
            windowTxs, sparkPoints, minBalance, minDate } = analysis;
    const st = surplusStatus(surplus);

    if (badgeEl) {
        badgeEl.className   = `health-badge ${st.cls}`;
        badgeEl.textContent = st.label;
    }

    // Destroy any previous sparkline before overwriting the DOM
    if (app._healthSurplusSparkline) { app._healthSurplusSparkline.destroy(); app._healthSurplusSparkline = null; }

    const recs = buildSurplusRecommendations(app, surplus);
    const hasDebtRecs    = recs.some(r => r.category === 'debt');
    const hasSavingsRecs = recs.some(r => r.category === 'savings');
    const showAllocSlider = hasDebtRecs && hasSavingsRecs;

    // ── Balance dip warning ───────────────────────────────────────────────────
    const dipWarningHtml = (surplus > 0 && minBalance < minimumReserve) ? `
        <div class="health-surplus-dip-warning">
            &#9888; Balance dips to ${escapeHtml(formatCurrency(minBalance))} on
            ${escapeHtml(minDate instanceof Date ? minDate.toLocaleDateString() : String(minDate))}
            &mdash; below your minimum reserve.
        </div>` : '';

    // ── Transaction detail toggle ─────────────────────────────────────────────
    const incomeTxs  = (windowTxs || []).filter(tx => tx.originalAmount > 0);
    const expenseTxs = (windowTxs || []).filter(tx => tx.originalAmount < 0);
    const txCount    = incomeTxs.length + expenseTxs.length;

    function txRow(tx) {
        const sign = tx.originalAmount >= 0 ? '+' : '';
        const cls  = tx.originalAmount >= 0 ? 'health-cf-income' : 'health-cf-out';
        return `<div class="health-surplus-tx-row">
            <span class="health-surplus-tx-name">${escapeHtml(tx.name || '')}</span>
            <span class="health-surplus-tx-date">${escapeHtml(tx.date instanceof Date ? tx.date.toLocaleDateString() : String(tx.date))}</span>
            <span class="health-surplus-tx-amt ${cls}">${sign}${escapeHtml(formatCurrency(tx.originalAmount))}</span>
        </div>`;
    }

    const txDetailHtml = txCount === 0 ? '' : `
        <button class="health-surplus-tx-toggle" id="healthSurplusTxToggle" aria-expanded="false" aria-controls="healthSurplusTxDetail">
            &#x25BC; Show projected transactions (${txCount})
        </button>
        <div id="healthSurplusTxDetail" class="health-surplus-tx-detail" hidden>
            ${incomeTxs.length > 0 ? `
                <div class="health-surplus-tx-group-label">Income (${incomeTxs.length})</div>
                ${incomeTxs.map(txRow).join('')}
            ` : ''}
            ${expenseTxs.length > 0 ? `
                <div class="health-surplus-tx-group-label health-surplus-tx-group-label--spaced">Expenses (${expenseTxs.length})</div>
                ${expenseTxs.map(txRow).join('')}
            ` : ''}
        </div>`;

    // ── Allocation slider (only when both categories present) ─────────────────
    const allocSliderHtml = showAllocSlider ? `
        <div class="health-surplus-alloc-row">
            <span class="health-surplus-alloc-label">
                Allocation &mdash; Debt: <strong id="healthSurplusAllocDebt">${_surplusDebtPct}%</strong>
                &nbsp;/&nbsp; Savings: <strong id="healthSurplusAllocSave">${100 - _surplusDebtPct}%</strong>
            </span>
            <input type="range" class="health-surplus-alloc-slider" id="healthSurplusAllocSlider"
                   min="0" max="100" step="5" value="${_surplusDebtPct}"
                   aria-label="Allocate surplus between debt and savings">
        </div>` : '';

    // ── Recommendations ───────────────────────────────────────────────────────
    function recHtml(r) {
        const monthsTag = r.monthsSaved > 0
            ? `<span class="health-surplus-rec-accel">${r.monthsSaved} mo sooner</span>` : '';
        return `<div class="health-surplus-rec health-surplus-rec--${r.category}"
                     data-raw-amount="${r.amount}" data-category="${r.category}">
            <div class="health-surplus-rec-info">
                <div class="health-surplus-rec-strategy">${escapeHtml(r.label)}</div>
                <div class="health-surplus-rec-name">${escapeHtml(r.name)}${r.extra ? ` &mdash; <span class="health-surplus-rec-extra">${escapeHtml(r.extra)}</span>` : ''}${monthsTag}</div>
            </div>
            <div class="health-surplus-rec-amount">+${escapeHtml(formatCurrency(r.amount))}</div>
        </div>`;
    }

    resultDiv.innerHTML = `
        <div class="health-cashflow-hero ${surplus >= 0 ? 'health-cashflow-hero--positive' : 'health-cashflow-hero--negative'} health-surplus-hero">
            ${surplus >= 0 ? '+' : ''}${escapeHtml(formatCurrency(surplus))}
        </div>
        <div class="health-surplus-breakdown">
            <span>Current balance</span><span>${escapeHtml(formatCurrency(currentBalance))}</span>
            <span>Est. income (${windowDays}d)</span><span class="health-cf-income">+${escapeHtml(formatCurrency(windowIncome))}</span>
            <span>Est. expenses (${windowDays}d)</span><span class="health-cf-out">&minus;${escapeHtml(formatCurrency(windowOutflow))}</span>
            <span>Cushion (${cushionPct}%)</span><span class="health-cf-out">&minus;${escapeHtml(formatCurrency(cushionAmount))}</span>
            <span>Minimum reserve</span><span class="health-cf-out">&minus;${escapeHtml(formatCurrency(minimumReserve))}</span>
        </div>
        ${dipWarningHtml}
        <div class="health-surplus-sparkline-wrap">
            <canvas id="healthSurplusSparkline" height="80" aria-label="Projected balance over ${windowDays} days"></canvas>
        </div>
        ${txDetailHtml}
        ${recs.length > 0 ? `
            ${allocSliderHtml}
            <div class="health-surplus-recs-label">Ways to put your surplus to work:</div>
            <div class="health-surplus-recs" id="healthSurplusRecs">
                ${recs.map(recHtml).join('')}
            </div>
        ` : surplus > 0 ? `
            <div class="health-empty-state"><span class="health-empty-sub">No active debts or open savings goals to recommend.</span></div>
        ` : `
            <div class="health-surplus-deficit-note">Reduce expenses or increase income over the next ${windowDays} days to free up cash.</div>
        `}
    `;

    // ── Sparkline chart ───────────────────────────────────────────────────────
    const sparkCanvas = document.getElementById('healthSurplusSparkline');
    if (sparkCanvas && sparkPoints && sparkPoints.length > 1) {
        // Fix the canvas to its container dimensions before Chart.js touches it,
        // preventing responsive-mode from computing a huge height on a just-shown section.
        sparkCanvas.style.width  = `${sparkCanvas.parentElement.clientWidth || 300}px`;
        sparkCanvas.style.height = '80px';

        const isDark   = document.body.classList.contains('dark-mode');
        const lineClr  = surplus >= 0 ? '#15803d' : '#dc2626';
        const fillClr  = surplus >= 0 ? 'rgba(21,128,61,0.10)' : 'rgba(220,38,38,0.10)';
        const gridClr  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        const tickClr  = isDark ? '#94a3b8' : '#64748b';

        app._healthSurplusSparkline = new Chart(sparkCanvas, {
            type: 'line',
            data: {
                labels: sparkPoints.map(p => p.date instanceof Date ? p.date.toLocaleDateString() : String(p.date)),
                datasets: [
                    {
                        label: 'Projected balance',
                        data: sparkPoints.map(p => p.balance),
                        fill: true,
                        tension: 0.3,
                        borderColor: lineClr,
                        backgroundColor: fillClr,
                        borderWidth: 2,
                        pointRadius: sparkPoints.length <= 12 ? 3 : 0,
                        pointHoverRadius: 5,
                    },
                    {
                        label: 'Minimum reserve',
                        data: sparkPoints.map(() => minimumReserve),
                        fill: false,
                        borderColor: '#f59e0b',
                        borderDash: [5, 4],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                    },
                ],
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
                        },
                    },
                },
                scales: {
                    x: { display: false },
                    y: {
                        ticks: {
                            callback: v => formatCurrency(v),
                            font: { size: 10 },
                            maxTicksLimit: 4,
                            color: tickClr,
                        },
                        grid: { color: gridClr },
                    },
                },
            },
        });
        renderChartDataTable('healthSurplusSparkline', {
            caption: t('health.surplusSparklineCaption', { days: windowDays }),
            columns: ['Date', 'Balance'],
            rows: sparkPoints.map(p => [
                p.date instanceof Date ? p.date.toLocaleDateString() : String(p.date),
                formatCurrency(p.balance),
            ]),
        });
    }

    // ── Toggle & slider event wiring ──────────────────────────────────────────
    const txToggle = document.getElementById('healthSurplusTxToggle');
    const txDetail = document.getElementById('healthSurplusTxDetail');
    if (txToggle && txDetail) {
        txToggle.addEventListener('click', () => {
            const expanded = !txDetail.hidden;
            txDetail.hidden = expanded;
            txToggle.setAttribute('aria-expanded', String(!expanded));
            txToggle.textContent = expanded
                ? `▼ Show projected transactions (${txCount})`
                : `▲ Hide projected transactions`;
        });
    }

    const allocSlider = document.getElementById('healthSurplusAllocSlider');
    if (allocSlider && showAllocSlider) {
        allocSlider.addEventListener('input', () => {
            _surplusDebtPct = parseInt(allocSlider.value, 10);
            const saveEl = document.getElementById('healthSurplusAllocSave');
            const debtEl = document.getElementById('healthSurplusAllocDebt');
            if (debtEl) debtEl.textContent = `${_surplusDebtPct}%`;
            if (saveEl) saveEl.textContent = `${100 - _surplusDebtPct}%`;

            const debtAlloc = surplus * (_surplusDebtPct / 100);
            const saveAlloc = surplus * ((100 - _surplusDebtPct) / 100);
            document.querySelectorAll('#healthSurplusRecs .health-surplus-rec').forEach(row => {
                const rawAmt = parseFloat(row.dataset.rawAmount) || 0;
                const cat    = row.dataset.category;
                const alloc  = cat === 'debt' ? debtAlloc : saveAlloc;
                const newAmt = Math.min(rawAmt, alloc);
                const amtEl  = row.querySelector('.health-surplus-rec-amount');
                if (amtEl) amtEl.textContent = `+${formatCurrency(newAmt)}`;
            });
        });
    }
}

function gaugeColor(statusCls) {
    if (statusCls === 'health-status--green') return '#16a34a';
    if (statusCls === 'health-status--yellow') return '#d97706';
    return '#dc2626';
}

export function renderHealthDashboard(app) {
    const section = document.getElementById('healthSection');
    if (!section) return;

    if (app._healthDtiChart)        { app._healthDtiChart.destroy();        app._healthDtiChart = null; }
    if (app._healthSavingsChart)    { app._healthSavingsChart.destroy();    app._healthSavingsChart = null; }
    if (app._healthSurplusSparkline){ app._healthSurplusSparkline.destroy(); app._healthSurplusSparkline = null; }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // ── Shared data ────────────────────────────────────────────────────────────
    const { monthlyTotal: monthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, year, month);
    const activeDebts   = (app.debts || []).filter(d => !d.archived);
    const totalBills    = (app.bills    || []).reduce((s, b) => s + (b.amount        || 0), 0);
    const totalExpenses = (app.expenses || []).reduce((s, e) => s + (e.budgetAmount  || 0), 0);
    const totalDebtMin  = activeDebts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const totalOutflow  = totalBills + totalExpenses + totalDebtMin;
    const net           = monthlyIncome - totalOutflow;

    // ── DTI ────────────────────────────────────────────────────────────────────
    const dtiRatio = monthlyIncome > 0 ? totalDebtMin / monthlyIncome : 0;
    const dtiPct   = Math.min(dtiRatio * 100, 100);
    const dtiSt    = dtiStatus(dtiRatio);

    // ── Savings Rate ───────────────────────────────────────────────────────────
    const totalSavingsContrib =
        (app.emergencyFunds || []).reduce((s, f) => s + (f.monthlyContribution || 0), 0) +
        (app.sinkingFunds   || []).reduce((s, f) => s + (f.monthlyAllocation   || 0), 0);
    const savingsRatio = monthlyIncome > 0 ? totalSavingsContrib / monthlyIncome : 0;
    const savingsPct   = Math.min(savingsRatio * 100, 100);
    const savingsSt    = savingsStatus(savingsRatio);

    // ── Prev-month income for trend arrows ────────────────────────────────────
    const prevYear  = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    const { monthlyTotal: prevMonthlyIncome } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, prevYear, prevMonth);
    const prevDtiPct      = prevMonthlyIncome > 0 ? (totalDebtMin / prevMonthlyIncome) * 100 : null;
    const prevSavingsPct  = prevMonthlyIncome > 0 ? (totalSavingsContrib / prevMonthlyIncome) * 100 : null;
    const prevNet         = prevMonthlyIncome - totalOutflow;

    // ── Emergency Fund Coverage ────────────────────────────────────────────────
    const emergencyFunds = app.emergencyFunds || [];

    // ── Debt Payoff Timeline ───────────────────────────────────────────────────
    const hasDebts = activeDebts.length > 0;
    let debtTimeline = null;
    if (hasDebts) {
        if (app.lastSummary && typeof app.lastSummary.monthsToPayOff === 'number') {
            debtTimeline = app.lastSummary;
        } else {
            try {
                const payment = Math.max(totalDebtMin, 1);
                const result  = DebtCalculator.calculatePaymentPlan(activeDebts, payment, 'avalanche');
                debtTimeline  = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
            } catch (_) { /* silent */ }
        }
    }
    const timelineMonths = debtTimeline ? debtTimeline.monthsToPayOff : 0;
    const timelineYears  = (timelineMonths / 12).toFixed(1);
    const timelineSt     = timelineStatus(timelineMonths);
    const payoffDate     = debtTimeline ? debtTimeline.payOffDate : null;

    const totalDebtBalance  = activeDebts.reduce((s, d) =>
        s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0)), 0);
    const totalDebtOriginal = (app.debts || []).reduce((s, d) =>
        s + (d.originalBalance || d.accountBalance || d.fixedAmount || 0), 0);
    const debtProgress = totalDebtOriginal > 0
        ? Math.round(((totalDebtOriginal - totalDebtBalance) / totalDebtOriginal) * 100)
        : 0;

    // ── Monthly Cash Flow ──────────────────────────────────────────────────────
    const cashFlowSt = cashFlowStatus(net);

    // ── Budget Allocation ──────────────────────────────────────────────────────
    const otherLabel = t('health.otherCategory');
    const billCatMap = {};
    for (const b of (app.bills || [])) {
        const cat = b.category || otherLabel;
        billCatMap[cat] = (billCatMap[cat] || 0) + (b.amount || 0);
    }
    const expCatMap = {};
    for (const e of (app.expenses || [])) {
        const cat = e.category || otherLabel;
        expCatMap[cat] = (expCatMap[cat] || 0) + (e.budgetAmount || 0);
    }
    const allCats = new Set([...Object.keys(billCatMap), ...Object.keys(expCatMap)]);
    const budgetCategories = [];
    for (const cat of allCats) {
        const total = (billCatMap[cat] || 0) + (expCatMap[cat] || 0);
        const pct   = monthlyIncome > 0 ? total / monthlyIncome : 0;
        budgetCategories.push({ cat, total, pct });
    }
    budgetCategories.sort((a, b) => b.total - a.total);
    if (totalDebtMin > 0) {
        budgetCategories.unshift({
            cat: t('health.debtPaymentsCategory'), total: totalDebtMin,
            pct: monthlyIncome > 0 ? totalDebtMin / monthlyIncome : 0,
            isDebt: true
        });
    }

    // ── Credit Utilization ─────────────────────────────────────────────────────
    const ccDebtsWithLimit = activeDebts.filter(
        d => d.debtType === 'creditCard' && d.creditLimit != null && d.creditLimit > 0
    );
    const totalCreditBalance = ccDebtsWithLimit.reduce((s, d) => s + (d.accountBalance || 0), 0);
    const totalCreditLimit   = ccDebtsWithLimit.reduce((s, d) => s + d.creditLimit, 0);
    const rawUtilPct = totalCreditLimit > 0 ? Math.round((totalCreditBalance / totalCreditLimit) * 100) : 0;
    const utilDisplayPct = Math.min(rawUtilPct, 100);
    const utilSt = creditUtilizationStatus(rawUtilPct);
    const hasUtilData = ccDebtsWithLimit.length > 0;

    // ── Per-person utilization + DTI ───────────────────────────────────────────
    const personRows = (app.persons || []).map(p => {
        const personCcDebts = ccDebtsWithLimit.filter(d => (d.personIds || []).includes(p.id));
        const personAllDebts = activeDebts.filter(d => (d.personIds || []).includes(p.id));
        const pBalance = personCcDebts.reduce((s, d) => s + (d.accountBalance || 0), 0);
        const pLimit   = personCcDebts.reduce((s, d) => s + d.creditLimit, 0);
        const pUtilRaw = pLimit > 0 ? Math.round((pBalance / pLimit) * 100) : 0;
        const pUtilDisp = Math.min(pUtilRaw, 100);
        const pUtilSt = creditUtilizationStatus(pUtilRaw);
        const FREQ_MULTIPLIERS = { biweekly: 26, weekly: 52, twice_monthly: 24, monthly: 12 };
        const pAnnualIncome = (app.incomes || [])
            .filter(inc => inc.personId === p.id)
            .reduce((s, inc) => s + (inc.amount || 0) * (FREQ_MULTIPLIERS[inc.frequency] || 12), 0);
        const pMonthlyIncome = pAnnualIncome / 12;
        const pMinPayment = personAllDebts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
        const pDtiRaw = pMonthlyIncome > 0 ? Math.round((pMinPayment / pMonthlyIncome) * 100) : null;
        return { p, pUtilRaw, pUtilDisp, pUtilSt, pLimit, pBalance, pDtiRaw };
    });

    // ── Interest Burden Rate ───────────────────────────────────────────────────
    const monthlyInterest = activeDebts.reduce((s, d) => {
        const bal = d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
        return s + bal * ((d.interestRate || 0) / 100 / 12);
    }, 0);
    const ibRatio = monthlyIncome > 0 ? monthlyInterest / monthlyIncome : 0;
    const ibPct   = ibRatio * 100;
    const ibSt    = interestBurdenStatus(ibRatio);

    // ── Debt-to-Asset Ratio ────────────────────────────────────────────────────
    let dtaAssets = 0;
    for (const a of app.accounts || []) {
        const bal = app.computeAccountBalance(a.id, year, month);
        if (bal > 0) dtaAssets += bal;
    }
    const dtaLiabilities = (app.debts || []).reduce((s, d) => {
        const bal = d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
        return s + Math.max(0, bal);
    }, 0);
    const dtaRatio = dtaAssets > 0 ? dtaLiabilities / dtaAssets : null;
    const dtaSt    = dtaRatio !== null ? debtToAssetStatus(dtaRatio) : null;

    // ── Surplus Analysis ──────────────────────────────────────────────────────
    const accounts = app.accounts || [];
    const surplusAcctId   = getSetting(app, SURPLUS_ACCOUNT_ID, accounts[0]?.id ?? null);
    const surplusWindow   = getSetting(app, SURPLUS_WINDOW_DAYS, 90);
    const surplusCushion  = getSetting(app, SURPLUS_CUSHION_PCT, 20);

    const gaugeGray = document.body.classList.contains('dark-mode') ? '#334155' : '#e2e8f0';

    const monthYearLong = now.toLocaleDateString(getIntlLocale(), { month: 'long', year: 'numeric' });

    // ── HTML ───────────────────────────────────────────────────────────────────
    section.innerHTML = `
        <div class="health-header">
            <div class="page-header-row">
                <h2>${t('health.title')}</h2>
                <button type="button" class="page-print-btn" id="healthPrintBtn" title="${t('health.printTitle')}" aria-label="${t('health.printAriaLabel')}">🖨️ ${t('health.print')}</button>
            </div>
            <p class="health-subtitle">${t('health.subtitle', { month: monthYearLong })}</p>
        </div>
        <div class="health-metrics-grid">

            <!-- Debt-to-Income Ratio -->
            <div class="health-metric-card" data-card-nav="liabilities">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.dtiTitle')}</span>
                    <span class="health-badge ${dtiSt.cls}">${dtiSt.label}</span>
                    ${trendArrow(dtiPct, prevDtiPct, false)}
                </div>
                <p class="health-card-desc">${t('health.dtiDesc')}</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthDtiGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${dtiPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">${t('health.dtiGaugeLabel')}</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${t('health.perMonthDebt', { amount: formatCurrency(totalDebtMin) })}</span>
                    <span>${t('health.perMonthIncome', { amount: formatCurrency(monthlyIncome) })}</span>
                </div>
                <a href="#" class="health-link" data-health-nav="liabilities">${t('health.manageDebts')} &rarr;</a>
            </div>

            <!-- Savings Rate -->
            <div class="health-metric-card" data-card-nav="savings">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.savingsTitle')}</span>
                    <span class="health-badge ${savingsSt.cls}">${savingsSt.label}</span>
                    ${trendArrow(savingsPct, prevSavingsPct, true)}
                </div>
                <p class="health-card-desc">${t('health.savingsDesc')}</p>
                <div class="health-gauge-wrap">
                    <canvas id="healthSavingsGauge" class="health-gauge-canvas"></canvas>
                    <div class="health-gauge-center">
                        <span class="health-gauge-value">${savingsPct.toFixed(1)}%</span>
                        <span class="health-gauge-label">${t('health.savingsGaugeLabel')}</span>
                    </div>
                </div>
                <div class="health-metric-detail">
                    <span>${t('health.perMonthSaved', { amount: formatCurrency(totalSavingsContrib) })}</span>
                    <span>${t('health.perMonthIncome', { amount: formatCurrency(monthlyIncome) })}</span>
                </div>
                <a href="#" class="health-link" data-health-nav="savings">${t('health.manageSavings')} &rarr;</a>
            </div>

            <!-- Emergency Fund Coverage -->
            <div class="health-metric-card" data-card-nav="savings">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.efTitle')}</span>
                </div>
                <p class="health-card-desc">${t('health.efDesc')}</p>
                ${emergencyFunds.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value">${t('health.efEmptyMonths')}</span>
                        <span class="health-empty-sub">${t('health.efEmptySub')}</span>
                    </div>
                    <a href="#" class="health-link" data-health-nav="savings">${t('health.efSetUp')} &rarr;</a>
                ` : emergencyFunds.map(fund => {
                    const coverageMonths = totalOutflow > 0 ? fund.currentAmount / totalOutflow : 0;
                    const coveragePct    = Math.min((coverageMonths / 6) * 100, 100);
                    const st             = emergencyStatus(coverageMonths);
                    const acctName       = (app.accounts || []).find(a => a.id === fund.accountId)?.name || t('health.unknownAccount');
                    return `
                        <div class="health-ef-row">
                            <div class="health-ef-header">
                                <span class="health-ef-name">${escapeHtml(acctName)}</span>
                                <span class="health-badge ${st.cls}">${coverageMonths.toFixed(1)} ${t('health.monthsUnit')}</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(st.cls)}" data-progress-width="${Math.round(coveragePct)}"></div>
                            </div>
                            <div class="health-ef-detail">${escapeHtml(st.label)}</div>
                        </div>`;
                }).join('')}
                ${emergencyFunds.length > 0 ? `<a href="#" class="health-link" data-health-nav="savings">${t('health.efManage')} &rarr;</a>` : ''}
            </div>

            <!-- Debt Payoff Timeline -->
            <div class="health-metric-card" data-card-nav="strategy">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.timelineTitle')}</span>
                    ${hasDebts && debtTimeline ? `<span class="health-badge ${timelineSt.cls}">${timelineSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">${t('health.timelineDesc')}</p>
                ${!hasDebts ? `
                    <div class="health-empty-state">
                        <span class="health-empty-value health-empty--green">${t('health.debtFree')}</span>
                    </div>
                ` : debtTimeline ? `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${timelineYears}</span>
                        <span class="health-timeline-unit">${t('health.years')}</span>
                    </div>
                    ${payoffDate ? `<div class="health-timeline-date">${t('health.estimatedPayoff')}: ${escapeHtml(payoffDate)}</div>` : ''}
                    <div class="health-progress-label">
                        <span>${t('health.originalDebtPaidOff')}</span>
                        <span>${debtProgress}%</span>
                    </div>
                    <div class="progress-bar health-compact-bar">
                        <div class="progress-fill ${statusFillCls(timelineSt.cls)}" data-progress-width="${debtProgress}"></div>
                    </div>
                    <div class="health-metric-detail">
                        <span>${t('health.balance')}: ${formatCurrency(totalDebtBalance)}</span>
                        <span>${timelineMonths} ${t('health.monthsRemaining')}</span>
                    </div>
                ` : `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">${t('health.unableToCalculate')}</span>
                    </div>
                `}
                <a href="#" class="health-link" data-health-nav="strategy">${t('health.goToPlan')} &rarr;</a>
            </div>

            <!-- Monthly Cash Flow -->
            <div class="health-metric-card" data-card-nav="income">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.cashFlowTitle')}</span>
                    <span class="health-badge ${cashFlowSt.cls}">${cashFlowSt.label}</span>
                    ${trendArrow(net, prevNet, true, { suffix: '', decimals: 0 })}
                </div>
                <p class="health-card-desc">${t('health.cashFlowDesc')}</p>
                <div class="health-cashflow-hero ${net >= 0 ? 'health-cashflow-hero--positive' : 'health-cashflow-hero--negative'}">
                    ${net >= 0 ? '+' : ''}${formatCurrency(net)}
                </div>
                <div class="health-cashflow-rows">
                    <div class="health-cashflow-row">
                        <span>${t('health.income')}</span>
                        <span class="health-cf-income">${formatCurrency(monthlyIncome)}</span>
                    </div>
                    ${totalDebtMin > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.debtPayments')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalDebtMin)}</span>
                    </div>` : ''}
                    ${totalBills > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.bills')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalBills)}</span>
                    </div>` : ''}
                    ${totalExpenses > 0 ? `<div class="health-cashflow-row">
                        <span>${t('health.expenses')}</span>
                        <span class="health-cf-out">&minus;${formatCurrency(totalExpenses)}</span>
                    </div>` : ''}
                    <div class="health-cashflow-row health-cashflow-row--total">
                        <span>${t('health.netRemaining')}</span>
                        <span class="${net >= 0 ? 'health-cf-income' : 'health-cf-deficit'}">${formatCurrency(net)}</span>
                    </div>
                </div>
                <a href="#" class="health-link" data-health-nav="liabilities">${t('health.viewBudget')} &rarr;</a>
            </div>

            <!-- Budget Allocation -->
            <div class="health-metric-card" data-card-nav="liabilities">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.budgetTitle')}</span>
                </div>
                <p class="health-card-desc">${t('health.budgetDesc')}</p>
                ${monthlyIncome === 0 || budgetCategories.length === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">${t('health.budgetEmptySub')}</span>
                    </div>
                ` : budgetCategories.map(({ cat, total, pct, isDebt }) => {
                    const barPct   = Math.min(pct * 100, 100);
                    const stCls    = isDebt
                        ? (pct < 0.15 ? 'health-status--green' : pct < 0.20 ? 'health-status--yellow' : 'health-status--red')
                        : budgetCategoryStatusCls(pct, cat);
                    return `
                        <div class="health-budget-row">
                            <div class="health-budget-cat-hd">
                                <span class="health-budget-cat-name">${escapeHtml(cat)}</span>
                                <span class="health-badge health-badge--sm ${stCls}">${(pct * 100).toFixed(1)}%</span>
                            </div>
                            <div class="progress-bar health-compact-bar">
                                <div class="progress-fill ${statusFillCls(stCls)}" data-progress-width="${Math.round(barPct)}"></div>
                            </div>
                            <div class="health-budget-cat-amt">${formatCurrency(total)}${t('health.perMonthSuffix')}</div>
                        </div>`;
                }).join('')}
                ${budgetCategories.length > 0 ? `<a href="#" class="health-link" data-health-nav="liabilities">${t('health.editBudget')} &rarr;</a>` : ''}
            </div>

            <!-- Credit Utilization -->
            <div class="health-metric-card" id="healthCreditUtilCard" data-card-nav="liabilities">
                <div class="health-card-header">
                    <span class="health-card-title">Credit Utilization</span>
                    ${hasUtilData ? `<span class="health-badge ${utilSt.cls}">${utilSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">Total balance vs. credit limit across all credit cards with a limit set.</p>
                ${!hasUtilData ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">No credit limits set on any credit card debt.</span>
                    </div>
                    <a href="#" class="health-link" data-health-nav="liabilities">Set a credit limit &rarr;</a>
                ` : `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${rawUtilPct}${rawUtilPct >= 100 ? '<span class="health-timeline-unit"> ⚠</span>' : ''}</span>
                        <span class="health-timeline-unit">%</span>
                    </div>
                    <div class="health-progress-label">
                        <span>Used credit</span>
                        <span>${utilDisplayPct}%${rawUtilPct > 100 ? ' (over limit)' : ''}</span>
                    </div>
                    <div class="progress-bar health-compact-bar">
                        <div class="progress-fill ${statusFillCls(utilSt.cls)}" data-progress-width="${utilDisplayPct}"></div>
                    </div>
                    <div class="health-metric-detail">
                        <span>Balance: ${formatCurrency(totalCreditBalance)}</span>
                        <span>Limit: ${formatCurrency(totalCreditLimit)}</span>
                    </div>
                    ${personRows.length > 0 ? `
                        <div class="health-person-util-list">
                            ${personRows.map(({ p, pUtilRaw, pUtilDisp, pUtilSt, pLimit, pBalance, pDtiRaw }) => `
                                <div class="health-person-util-row">
                                    <div class="health-person-util-hd">
                                        <span class="health-person-util-name">${escapeHtml(p.name)}</span>
                                        <span class="health-badge health-badge--sm ${pUtilSt.cls}">${pUtilRaw}%</span>
                                        ${pDtiRaw !== null ? `<span class="health-person-util-dti">DTI ${pDtiRaw}%</span>` : ''}
                                    </div>
                                    <div class="progress-bar health-compact-bar">
                                        <div class="progress-fill ${statusFillCls(pUtilSt.cls)}" data-progress-width="${pUtilDisp}"></div>
                                    </div>
                                    ${pLimit > 0 ? `<div class="health-person-util-detail">${formatCurrency(pBalance)} of ${formatCurrency(pLimit)}</div>` : '<div class="health-person-util-detail">No credit cards assigned</div>'}
                                </div>`).join('')}
                        </div>
                    ` : ''}
                    <a href="#" class="health-link" data-health-nav="liabilities">Manage debts &rarr;</a>
                `}
            </div>

            <!-- Interest Burden Rate -->
            <div class="health-metric-card" id="healthInterestBurdenCard" data-card-nav="liabilities">
                <div class="health-card-header">
                    <span class="health-card-title">Interest Burden Rate</span>
                    ${hasDebts ? `<span class="health-badge ${ibSt.cls}">${ibSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">Monthly interest cost as a % of income. Above 10% signals high-cost debt dragging on your finances.</p>
                ${!hasDebts ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">No active debts.</span>
                    </div>
                ` : `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${ibPct.toFixed(1)}</span>
                        <span class="health-timeline-unit">%</span>
                    </div>
                    <div class="health-metric-detail">
                        <span>Interest: ${formatCurrency(monthlyInterest)}/mo</span>
                        <span>Income: ${formatCurrency(monthlyIncome)}/mo</span>
                    </div>
                `}
                <a href="#" class="health-link" data-health-nav="liabilities">Manage debts &rarr;</a>
            </div>

            <!-- Debt-to-Asset Ratio -->
            <div class="health-metric-card" id="healthDebtToAssetCard" data-card-nav="accounts">
                <div class="health-card-header">
                    <span class="health-card-title">${t('health.dtaTitle')}</span>
                    ${dtaSt ? `<span class="health-badge ${dtaSt.cls}">${dtaSt.label}</span>` : ''}
                </div>
                <p class="health-card-desc">${t('health.dtaDesc')}</p>
                ${dtaAssets === 0 ? `
                    <div class="health-empty-state">
                        <span class="health-empty-sub">${t('health.dtaNoAssets')}</span>
                    </div>
                    <a href="#" class="health-link" data-health-nav="accounts">${t('health.dtaAddAccounts')} &rarr;</a>
                ` : `
                    <div class="health-timeline-hero">
                        <span class="health-timeline-value">${dtaRatio.toFixed(2)}</span>
                    </div>
                    <div class="health-metric-detail">
                        <span>${t('health.dtaLiabilities', { amount: formatCurrency(dtaLiabilities) })}</span>
                        <span>${t('health.dtaAssets', { amount: formatCurrency(dtaAssets) })}</span>
                    </div>
                    <a href="#" class="health-link" data-health-nav="accounts">${t('health.dtaViewAccounts')} &rarr;</a>
                `}
            </div>

            <!-- Surplus Analysis -->
            <div class="health-metric-card health-surplus-card" data-card-nav="accounts">
                <div class="health-card-header">
                    <span class="health-card-title">Surplus Analysis</span>
                    <span class="health-badge" id="healthSurplusBadge">&mdash;</span>
                </div>
                <p class="health-card-desc">Estimates free cash over a rolling window by subtracting projected expenses (plus a cushion) from your current account balance.</p>
                <div class="health-surplus-controls">
                    <div class="health-surplus-ctrl-group">
                        <label class="health-surplus-label" for="healthSurplusAcct">Account</label>
                        <select class="health-surplus-select" id="healthSurplusAcct">
                            ${accounts.length === 0
                                ? '<option value="">No accounts</option>'
                                : accounts.map(a => `<option value="${a.id}"${a.id === surplusAcctId ? ' selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="health-surplus-ctrl-group">
                        <label class="health-surplus-label" for="healthSurplusWindow">Window</label>
                        <div class="health-surplus-input-wrap">
                            <input type="number" class="health-surplus-input" id="healthSurplusWindow" value="${surplusWindow}" min="7" max="365" step="1">
                            <span class="health-surplus-unit">days</span>
                        </div>
                    </div>
                    <div class="health-surplus-ctrl-group">
                        <label class="health-surplus-label" for="healthSurplusCushion">Cushion</label>
                        <div class="health-surplus-input-wrap">
                            <input type="number" class="health-surplus-input" id="healthSurplusCushion" value="${surplusCushion}" min="0" max="100" step="1">
                            <span class="health-surplus-unit">%</span>
                        </div>
                    </div>
                </div>
                <div id="healthSurplusResult"></div>
                <a href="#" class="health-link" data-health-nav="accounts">View Accounts &rarr;</a>
            </div>

        </div>
    `;

    section.querySelectorAll('[data-progress-width]').forEach(el =>
        el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));

    renderGauge(app, '_healthDtiChart',     'healthDtiGauge',     dtiPct,     dtiSt.cls,     gaugeGray);
    renderGauge(app, '_healthSavingsChart', 'healthSavingsGauge', savingsPct, savingsSt.cls, gaugeGray);

    renderChartDataTable('healthDtiGauge', {
        caption: t('health.dtiTitle'),
        columns: [t('health.srTableMetric'), t('health.srTableValue')],
        rows: [
            [t('health.dtiTitle'), `${dtiPct.toFixed(1)}%`],
            [t('health.monthlyDebtPayments'), formatCurrency(totalDebtMin)],
            [t('health.monthlyIncome'), formatCurrency(monthlyIncome)]
        ]
    });
    renderChartDataTable('healthSavingsGauge', {
        caption: t('health.savingsTitle'),
        columns: [t('health.srTableMetric'), t('health.srTableValue')],
        rows: [
            [t('health.savingsTitle'), `${savingsPct.toFixed(1)}%`],
            [t('health.monthlyAmountSaved'), formatCurrency(totalSavingsContrib)],
            [t('health.monthlyIncome'), formatCurrency(monthlyIncome)]
        ]
    });

    section.querySelectorAll('[data-health-nav]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            app.switchPage(link.dataset.healthNav);
        });
    });

    section.querySelectorAll('[data-card-nav]').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('a, button, input, select')) return;
            app.switchPage(card.dataset.cardNav);
        });
    });

    const healthPrintBtn = document.getElementById('healthPrintBtn');
    if (healthPrintBtn) {
        healthPrintBtn.addEventListener('click', () => window.print());
    }

    // ── Surplus Analysis wiring ────────────────────────────────────────────────
    renderSurplusSection(app);

    const surplusAcctSel   = document.getElementById('healthSurplusAcct');
    const surplusWinInput  = document.getElementById('healthSurplusWindow');
    const surplusCushInput = document.getElementById('healthSurplusCushion');

    if (surplusAcctSel) {
        surplusAcctSel.addEventListener('change', () => {
            setSetting(app, SURPLUS_ACCOUNT_ID, parseInt(surplusAcctSel.value, 10) || null);
            renderSurplusSection(app);
        });
    }
    if (surplusWinInput) {
        surplusWinInput.addEventListener('change', () => {
            const v = Math.max(7, Math.min(365, parseInt(surplusWinInput.value, 10) || 90));
            surplusWinInput.value = v;
            setSetting(app, SURPLUS_WINDOW_DAYS, v);
            renderSurplusSection(app);
        });
    }
    if (surplusCushInput) {
        surplusCushInput.addEventListener('change', () => {
            const v = Math.max(0, Math.min(100, parseInt(surplusCushInput.value, 10) || 20));
            surplusCushInput.value = v;
            setSetting(app, SURPLUS_CUSHION_PCT, v);
            renderSurplusSection(app);
        });
    }
}

function renderGauge(app, chartKey, canvasId, pct, statusCls, bgColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (app[chartKey]) { app[chartKey].destroy(); app[chartKey] = null; }
    const color = gaugeColor(statusCls);
    app[chartKey] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [Math.max(pct, 0), Math.max(100 - pct, 0)],
                backgroundColor: [color, bgColor],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '72%',
            circumference: 270,
            rotation: 135,
            plugins: {
                legend:  { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}
