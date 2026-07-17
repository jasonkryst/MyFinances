// Debt break-even analysis: badge rendering, mini chart, and the accelerate-debt modal
import { formatCurrency, escapeHtml, renderChartDataTable } from './utils.js';
import { computeBreakEven } from './breakEven.js';

export function renderBreakEvenBadge(app, debt, container) {
    const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
    const planPayment = summaryRow
        ? (app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === debt.name)?.payment || debt.minimumPayment)
        : null;
    const hasPlan = !!app.lastPaymentPlan && !!summaryRow;

    const section = container.querySelector('.break-even-section');
    const minType = section?.querySelector('.be-min-type')?.value || 'fixed';
    const minPct = parseFloat(section?.querySelector('.be-min-pct')?.value) || 2;

    const revealed = section?.dataset.revealed === 'true';

    // Must destroy before DOM removal — Chart.js cleanup requires canvas still attached.
    const existingChartId = `be-chart-${debt.id}`;
    if (app._breakEvenCharts && app._breakEvenCharts[existingChartId]) {
        try { app._breakEvenCharts[existingChartId].destroy(); } catch (_) { /* ignore */ }
        delete app._breakEvenCharts[existingChartId];
    }

    if (!hasPlan && !revealed) {
        // No plan, not yet shown — render the "Show" action button
        container.querySelector('.break-even-section')?.remove();
        const s = document.createElement('div');
        s.className = 'break-even-section';
        s.dataset.revealed = 'false';
        s.innerHTML = `<button class="btn btn-secondary btn-small break-even-show-btn" data-be-show="${debt.id}">Show payoff estimate</button>`;
        container.querySelector('.debt-details').after(s);
        return;
    }

    const opts = { minType, minPct, planPayment: planPayment || debt.minimumPayment };
    const result = computeBreakEven(debt, opts);

    container.querySelector('.break-even-section')?.remove();
    const s = document.createElement('div');
    s.className = 'break-even-section';
    s.dataset.revealed = 'true';

    const toggleHTML = `
        <div class="break-even-toggle-row">
            <select class="be-min-type" aria-label="Minimum type">
                <option value="fixed"${minType === 'fixed' ? ' selected' : ''}>Fixed</option>
                <option value="percent"${minType === 'percent' ? ' selected' : ''}>%</option>
            </select>
            ${minType === 'percent' ? `<input class="be-min-pct" type="number" min="0.1" max="100" step="0.1" value="${minPct}" aria-label="Percent of balance">` : ''}
        </div>`;

    if (!result) {
        s.innerHTML = `<div class="break-even-header">Payoff Analysis</div>${toggleHTML}<div class="break-even-no-plan-banner">Unable to compute — check debt settings.</div>`;
        container.querySelector('.debt-details').after(s);
        return;
    }

    const payoffMonthLabel = (n) => `${n} month${n !== 1 ? 's' : ''}`;
    let contentHTML = `<div class="break-even-header">Payoff Analysis</div>${toggleHTML}`;

    if (!hasPlan) {
        contentHTML += `<div class="break-even-no-plan-banner">Estimate only — no plan calculated. Run a plan on the Strategy page to see your interest savings.</div>`;
        contentHTML += `
            <div class="break-even-row"><span class="break-even-label">Min only:</span>
                <span class="break-even-value">${payoffMonthLabel(result.minMonths)} · ${escapeHtml(formatCurrency(result.minInterest))} interest</span></div>`;
    } else {
        contentHTML += `
            <div class="break-even-row"><span class="break-even-label">Your plan:</span>
                <span class="break-even-value">${payoffMonthLabel(result.planMonths)} · ${escapeHtml(formatCurrency(result.planInterest))} interest</span></div>
            <div class="break-even-row"><span class="break-even-label">Min only:</span>
                <span class="break-even-value">${payoffMonthLabel(result.minMonths)} · ${escapeHtml(formatCurrency(result.minInterest))} interest</span></div>`;

        if (result.interestSaved > 0 || result.monthsSaved > 0) {
            contentHTML += `<div class="break-even-savings break-even-savings--positive">You save ${escapeHtml(formatCurrency(result.interestSaved))} and ${result.monthsSaved} month${result.monthsSaved !== 1 ? 's' : ''}!</div>`;
        } else {
            contentHTML += `<div class="break-even-savings">No savings vs. minimum — consider a larger payment.</div>`;
        }
    }

    const chartId = `be-chart-${debt.id}`;
    contentHTML += `<div class="break-even-chart-wrap"><canvas id="${chartId}" aria-label="Balance over time chart for ${escapeHtml(debt.name)}"></canvas></div>`;
    contentHTML += `<button class="btn btn-secondary btn-small break-even-accelerate-btn" data-be-accelerate="${debt.id}">Accelerate this debt →</button>`;

    s.innerHTML = contentHTML;
    container.querySelector('.debt-details').after(s);

    // Render mini chart
    _renderBreakEvenChart(app, chartId, result, hasPlan);

    // Accessibility data table
    const rows = result.planBalances.map((b, i) => [i === 0 ? 'Start' : `Mo ${i}`, formatCurrency(b), formatCurrency(result.minBalances[i] ?? 0)]);
    renderChartDataTable(chartId, {
        caption: `Balance over time: ${debt.name}`,
        columns: ['Month', 'Plan Balance', 'Min-Only Balance'],
        rows
    });
}

function _renderBreakEvenChart(app, chartId, result, hasPlan) {
    app._breakEvenCharts = app._breakEvenCharts || {};
    if (app._breakEvenCharts[chartId]) {
        try { app._breakEvenCharts[chartId].destroy(); } catch (_) { /* ignore */ }
        delete app._breakEvenCharts[chartId];
    }
    const canvas = document.getElementById(chartId);
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    const maxLen = Math.max(result.planBalances.length, result.minBalances.length);
    const labels = Array.from({ length: maxLen }, (_, i) => i === 0 ? 'Now' : `Mo ${i}`);
    const planData = [...result.planBalances, ...Array(maxLen - result.planBalances.length).fill(0)];
    const minData = [...result.minBalances, ...Array(maxLen - result.minBalances.length).fill(0)];

    const datasets = hasPlan
        ? [
            { label: 'Your Plan', data: planData, borderColor: '#2563eb', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 },
            { label: 'Min Only', data: minData, borderColor: '#dc2626', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3, borderDash: [4, 4] }
          ]
        : [
            { label: 'Min Only', data: minData, borderColor: '#dc2626', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 }
          ];

    app._breakEvenCharts[chartId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                y: { ticks: { callback: v => `$${Math.round(v)}`, font: { size: 10 } } }
            }
        }
    });
}

export function showAccelerateModal(app, debtId) {
    const debt = app.debts.find(d => Number(d.id) === Number(debtId));
    if (!debt || debt.debtType === 'fixedAmount') return;

    const modal = document.getElementById('accelerateDebtModal');
    if (!modal) return;

    const summaryRow = app._debtSummaryRows?.find(r => r.name === debt.name);
    const basePay = summaryRow
        ? (app.lastPaymentPlan?.[0]?.payments?.find(p => p.debtName === debt.name)?.payment || debt.minimumPayment)
        : debt.minimumPayment;

    document.getElementById('accelerateDebtTitle').textContent = `Accelerate: ${debt.name}`;
    document.getElementById('accelerateBasePay').textContent = formatCurrency(basePay);
    const extraInput = document.getElementById('accelerateExtraPay');
    extraInput.value = '0';

    function updatePreview() {
        const extra = Math.max(0, parseFloat(extraInput.value) || 0);
        const totalPay = basePay + extra;
        document.getElementById('accelerateNewTotal').textContent = formatCurrency(totalPay);

        const baseResult = computeBreakEven(debt, { planPayment: basePay });
        const newResult = computeBreakEven(debt, { planPayment: totalPay });

        if (!newResult) return;

        document.getElementById('acceleratePayoff').textContent = `${newResult.planMonths} month${newResult.planMonths !== 1 ? 's' : ''}`;
        document.getElementById('accelerateInterest').textContent = formatCurrency(newResult.planInterest);

        const mSaved = baseResult ? Math.max(0, baseResult.planMonths - newResult.planMonths) : 0;
        const iSaved = baseResult ? Math.max(0, baseResult.planInterest - newResult.planInterest) : 0;

        document.getElementById('acceleratePayoffDelta').textContent = mSaved > 0 ? `▲ ${mSaved} faster` : '';
        document.getElementById('accelerateInterestDelta').textContent = iSaved > 0 ? `▲ ${escapeHtml(formatCurrency(iSaved))} saved` : '';

        // Update chart
        if (app._accelerateChart) {
            try { app._accelerateChart.destroy(); } catch (_) { /* ignore */ }
            app._accelerateChart = null;
        }
        const canvas = document.getElementById('accelerateChart');
        if (canvas && typeof Chart !== 'undefined') {
            const maxLen = Math.max(newResult.planBalances.length, (baseResult?.planBalances.length || 0));
            const labels = Array.from({ length: maxLen }, (_, i) => i === 0 ? 'Now' : `Mo ${i}`);
            const newData = [...newResult.planBalances, ...Array(maxLen - newResult.planBalances.length).fill(0)];
            const baseData = baseResult ? [...baseResult.planBalances, ...Array(maxLen - baseResult.planBalances.length).fill(0)] : [];
            const datasets = [
                { label: formatCurrency(totalPay) + '/mo', data: newData, borderColor: '#2563eb', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3 }
            ];
            if (baseResult && extra > 0) {
                datasets.push({ label: formatCurrency(basePay) + '/mo', data: baseData, borderColor: '#9ca3af', backgroundColor: 'transparent', pointRadius: 0, tension: 0.3, borderDash: [4, 4] });
            }
            app._accelerateChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10 } } } },
                    scales: {
                        x: { ticks: { maxTicksLimit: 6, font: { size: 10 } } },
                        y: { ticks: { callback: v => `$${Math.round(v)}`, font: { size: 10 } } }
                    }
                }
            });
            renderChartDataTable('accelerateChart', {
                caption: `Accelerate: ${debt.name} — balance over time`,
                columns: ['Month', formatCurrency(totalPay) + '/mo', ...(baseResult && extra > 0 ? [formatCurrency(basePay) + '/mo'] : [])],
                rows: labels.map((lbl, i) => [lbl, formatCurrency(newData[i] ?? 0), ...(baseResult && extra > 0 ? [formatCurrency(baseData[i] ?? 0)] : [])])
            });
        }
    }

    extraInput.oninput = updatePreview;
    updatePreview();

    const lastFocused = document.activeElement;
    modal.classList.remove('hidden');
    setTimeout(() => extraInput.focus(), 50);

    const close = () => {
        modal.classList.add('hidden');
        if (app._accelerateChart) { try { app._accelerateChart.destroy(); } catch (_) { /* ignore */ } app._accelerateChart = null; }
        modal.onkeydown = null;
        if (lastFocused?.focus) lastFocused.focus();
    };

    document.getElementById('accelerateCloseBtn').onclick = close;
    document.getElementById('accelerateCloseBtnFooter').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
    modal.onkeydown = (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };

    document.getElementById('accelerateApplyBtn').onclick = () => {
        const extra = Math.max(0, parseFloat(extraInput.value) || 0);
        const totalPay = basePay + extra;
        close();
        app.switchPage('liabilities');
        // Navigate to Plan sub-tab
        const planTab = document.querySelector('[data-liabilities-subtab="plan"]');
        if (planTab) planTab.click();
        setTimeout(() => {
            const payEl = document.getElementById('monthlyPayment');
            if (payEl) { payEl.value = totalPay.toFixed(2); payEl.dispatchEvent(new Event('input')); }
            app.calculatePaymentPlanFromInputs();
        }, 100);
    };
}
