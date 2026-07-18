// Strategy comparison + what-if simulator feature module

import {
    formatCurrency,
    escapeHtml
} from './utils.js';

/**
 * Render strategy interest comparison panel.
 */
export function displayInterestComparison(app, currentStrategy, monthlyPayment) {
    const container = document.getElementById('interestComparison');
    if (!container || !monthlyPayment || isNaN(monthlyPayment)) { if (container) container.innerHTML = ''; return; }

    const strategies = [
        { key: 'avalanche', label: 'Avalanche' },
        { key: 'snowball', label: 'Snowball' },
        { key: 'priority-lowest', label: 'Priority Lowest' },
        { key: 'priority-highest', label: 'Priority Highest' }
    ];

    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0;
    const results = [];
    for (const s of strategies) {
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, monthlyPayment, s.key, stimulus);
            const sm = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            results.push({ ...s, totalInterest: sm.totalInterest, months: sm.monthsToPayOff, isCurrent: s.key === currentStrategy });
        } catch (e) {
            // Skip invalid configurations.
        }
    }
    if (results.length < 2) { container.innerHTML = ''; return; }

    results.sort((a, b) => a.totalInterest - b.totalInterest);
    const best = results[0];
    const current = results.find(r => r.isCurrent) || best;
    const interestSaved = current.totalInterest - best.totalInterest;
    const monthsSaved = current.months - best.months;

    let html = `<div class="interest-comparison"><h4>📊 Strategy Comparison</h4>`;
    if (interestSaved > 0.5) {
        html += `<div class="comparison-banner">Switching to <strong>${best.label}</strong> saves <strong>${formatCurrency(interestSaved)}</strong> in interest`;
        if (monthsSaved > 0) html += ` and pays off <strong>${monthsSaved} month${monthsSaved !== 1 ? 's' : ''} sooner</strong>`;
        html += '.</div>';
    } else {
        html += '<div class="comparison-banner comparison-banner--good">✅ You\'re already using the most interest-efficient strategy!</div>';
    }
    html += `<div class="table-wrapper"><table class="comparison-table">
        <thead><tr><th>Strategy</th><th>Total Interest</th><th>Months</th><th>Extra Cost vs. Best</th></tr></thead><tbody>`;
    for (const r of results) {
        const diff = r.totalInterest - best.totalInterest;
        html += `<tr class="${r.isCurrent ? 'comparison-current' : ''}">
            <td>${r.label}
                ${r.isCurrent ? '<span class="strat-badge strat-badge--current">Current</span>' : ''}
                ${r.key === best.key ? '<span class="strat-badge strat-badge--best">Best</span>' : ''}
            </td>
            <td>${formatCurrency(r.totalInterest)}</td>
            <td>${r.months} mo</td>
            <td>${diff > 0.5 ? `<span class="diff-cost">+${formatCurrency(diff)}</span>` : '<span class="diff-best">—</span>'}</td>
        </tr>`;
    }
    html += '</tbody></table></div></div>';
    container.innerHTML = html;
}

/**
 * Render What-If simulator panel.
 */
export function displayWhatIfSimulator(app, basePayment, strategy) {
    const container = document.getElementById('whatIfSimulator');
    if (!container || !app.lastSummary) { if (container) container.innerHTML = ''; return; }
    const baseSummary = app.lastSummary;
    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0;

    const sliderMax = Math.min(1000, Math.max(200, Math.round(basePayment)));

    container.innerHTML = `<div class="whatif-panel">
        <h4>🔧 What-If Simulator</h4>
        <p class="whatif-desc">Drag the slider to see how paying extra each month changes your payoff.</p>
        <div class="whatif-slider-row">
            <span class="whatif-slider-label">Extra/mo: <strong id="whatifExtraAmt">${formatCurrency(0)}</strong></span>
            <input type="range" id="whatifSlider" min="0" max="${sliderMax}" step="10" value="0">
            <span class="whatif-slider-cap">+${formatCurrency(sliderMax)}</span>
        </div>
        <div id="whatifResult"><p class="whatif-hint">Move the slider to simulate a higher payment.</p></div>
    </div>`;

    const slider = document.getElementById('whatifSlider');
    const extraAmtEl = document.getElementById('whatifExtraAmt');
    const resultDiv = document.getElementById('whatifResult');

    slider.addEventListener('input', () => {
        const extra = parseInt(slider.value, 10);
        extraAmtEl.textContent = formatCurrency(extra);
        if (extra === 0) {
            resultDiv.innerHTML = '<p class="whatif-hint">Move the slider to simulate a higher payment.</p>';
            return;
        }
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, basePayment + extra, strategy, stimulus);
            const s = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            const monthsSaved = Math.max(0, baseSummary.monthsToPayOff - s.monthsToPayOff);
            const interestSaved = Math.max(0, baseSummary.totalInterest - s.totalInterest);
            resultDiv.innerHTML = `<div class="whatif-metrics">
                <div class="whatif-metric">
                    <div class="whatif-metric-label">New Payoff Date</div>
                    <div class="whatif-metric-val">${DebtCalculator.formatDate(s.payOffDate)}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">Months Saved</div>
                    <div class="whatif-metric-val">${monthsSaved}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">Interest Saved</div>
                    <div class="whatif-metric-val">${formatCurrency(interestSaved)}</div>
                </div>
                <div class="whatif-metric">
                    <div class="whatif-metric-label">New Total Interest</div>
                    <div class="whatif-metric-val">${formatCurrency(s.totalInterest)}</div>
                </div>
            </div>`;
        } catch (e) {
            resultDiv.innerHTML = `<p class="error-message">${escapeHtml(e && e.message ? e.message : String(e))}</p>`;
        }
    });
}
