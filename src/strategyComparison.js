// Strategy comparison + what-if simulator feature module

import {
    formatCurrency,
    escapeHtml,
    debounce
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
 * Parse the refinancing "New APR %" input. Returns a finite number in [0, 100]
 * or null when blank / non-numeric / negative / over 100.
 */
export function parseRefinanceApr(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return null;
    const n = Number(text);
    return (Number.isFinite(n) && n >= 0 && n <= 100) ? n : null;
}

/**
 * Pure what-if: re-run the payoff plan with ONE debt's interestRate replaced.
 * Never mutates app.debts (uses a shallow-copied array of shallow-copied debts).
 * Returns { current, scenario, debt, oldApr, newApr, interestDelta, monthsDelta }
 * where interestDelta > 0 means the scenario saves interest.
 */
export function computeRefinanceScenario(app, basePayment, strategy, debtId, newApr) {
    const activeDebts = (app.debts || []).filter(d => !d.archived);
    const target = activeDebts.find(d => String(d.id) === String(debtId) && d.debtType !== 'fixedAmount');
    if (!target) throw new Error('Select a debt to refinance.');
    const stimulus = app.perMonthStimulus && app.perMonthStimulus.length > 0 ? app.perMonthStimulus : 0;
    const run = (debts) => {
        const r = DebtCalculator.calculatePaymentPlan(debts, basePayment, strategy, stimulus);
        return DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
    };
    const current = run(activeDebts);
    const scenarioDebts = activeDebts.map(d => d.id === target.id ? { ...d, interestRate: newApr } : d);
    const scenario = run(scenarioDebts);
    return {
        current, scenario, debt: target,
        oldApr: target.interestRate || 0, newApr,
        interestDelta: parseFloat((current.totalInterest - scenario.totalInterest).toFixed(2)),
        monthsDelta: current.monthsToPayOff - scenario.monthsToPayOff
    };
}

/** Clear the Refinancing scenario section back to its empty state (#320). */
export function resetRefinanceScenario(app) {
    const sel = document.getElementById('refiDebtSelect');
    const apr = document.getElementById('refiAprInput');
    const result = document.getElementById('refiResult');
    if (sel) sel.value = '';
    if (apr) { apr.value = ''; apr.removeAttribute('aria-invalid'); }
    if (result) result.innerHTML = '<p class="whatif-hint">Pick a debt and enter a new APR to compare.</p>';
    const details = document.getElementById('refiDetails');
    if (details) details.open = false;
}

function wireRefinanceSection(app, basePayment, strategy) {
    const sel = document.getElementById('refiDebtSelect');
    const aprInput = document.getElementById('refiAprInput');
    const result = document.getElementById('refiResult');
    const clearBtn = document.getElementById('refiClearBtn');
    if (!sel || !aprInput || !result || !clearBtn) return;

    const showError = (msg) => {
        result.innerHTML = `<p class="error-message" id="refiError" role="alert">${escapeHtml(msg)}</p>`;
        aprInput.setAttribute('aria-invalid', 'true');
    };
    const update = () => {
        aprInput.removeAttribute('aria-invalid');
        if (!sel.value) {
            result.innerHTML = '<p class="whatif-hint">Pick a debt and enter a new APR to compare.</p>';
            return;
        }
        if (aprInput.value.trim() === '') {
            result.innerHTML = '<p class="whatif-hint">Enter a new APR for the selected debt.</p>';
            return;
        }
        const newApr = parseRefinanceApr(aprInput.value);
        if (newApr === null) { showError('Enter a new APR between 0 and 100.'); return; }
        let r;
        try {
            r = computeRefinanceScenario(app, basePayment, strategy, sel.value, newApr);
        } catch (e) {
            showError(e && e.message ? e.message : String(e));
            return;
        }
        if (newApr === r.oldApr) {
            result.innerHTML = `<p class="whatif-hint" id="refiNoChange">No change: ${escapeHtml(r.debt.name)} is already at ${r.oldApr}% APR.</p>`;
            return;
        }
        const saved = r.interestDelta >= 0;
        const monthsText = r.monthsDelta === 0 ? '0' : (r.monthsDelta > 0 ? `${r.monthsDelta} sooner` : `${-r.monthsDelta} later`);
        result.innerHTML = `<div class="whatif-metrics">
            <div class="whatif-metric">
                <div class="whatif-metric-label">Payoff Date (current)</div>
                <div class="whatif-metric-val">${DebtCalculator.formatDate(r.current.payOffDate)}</div>
            </div>
            <div class="whatif-metric ${r.monthsDelta >= 0 ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label">Payoff Date (refinanced)</div>
                <div class="whatif-metric-val" id="refiNewDate">${DebtCalculator.formatDate(r.scenario.payOffDate)}</div>
            </div>
            <div class="whatif-metric ${r.monthsDelta >= 0 ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label">Months Saved</div>
                <div class="whatif-metric-val" id="refiMonths">${escapeHtml(monthsText)}</div>
            </div>
            <div class="whatif-metric ${saved ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label" id="refiInterestLabel">${saved ? 'Interest Saved' : 'Extra Interest Cost'}</div>
                <div class="whatif-metric-val" id="refiInterest">${formatCurrency(Math.abs(r.interestDelta))}</div>
            </div>
            <div class="whatif-metric">
                <div class="whatif-metric-label">New Total Interest</div>
                <div class="whatif-metric-val">${formatCurrency(r.scenario.totalInterest)}</div>
            </div>
        </div>
        <p class="whatif-hint" id="refiPaymentNote">${escapeHtml(r.debt.name)}: ${r.oldApr}% &rarr; ${newApr}% APR. Your total monthly payment stays fixed at ${formatCurrency(basePayment)}; the debt's minimum payment (${formatCurrency(r.debt.minimumPayment || 0)}) is not recalculated.</p>`;
    };

    sel.addEventListener('change', update);
    aprInput.addEventListener('input', update);
    clearBtn.addEventListener('click', () => { resetRefinanceScenario(app); sel.focus(); });
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
    const refiOptions = (app.debts || [])
        .filter(d => !d.archived && d.debtType !== 'fixedAmount')
        .map(d => `<option value="${escapeHtml(String(d.id))}">${escapeHtml(d.name)} (${escapeHtml(String(d.interestRate || 0))}% APR)</option>`)
        .join('');

    container.innerHTML = `<div class="whatif-panel">
        <h4>🔧 What-If Simulator</h4>
        <p class="whatif-desc">Drag the slider to see how paying extra each month changes your payoff.</p>
        <div class="whatif-slider-row">
            <span class="whatif-slider-label">Extra/mo: <strong id="whatifExtraAmt">${formatCurrency(0)}</strong></span>
            <input type="range" id="whatifSlider" min="0" max="${sliderMax}" step="10" value="0" aria-label="Extra monthly payment amount">
            <span class="whatif-slider-cap">+${formatCurrency(sliderMax)}</span>
        </div>
        <div id="whatifResult"><p class="whatif-hint">Move the slider to simulate a higher payment.</p></div>
        <details class="whatif-refi" id="refiDetails">
            <summary>Refinancing scenario</summary>
            <p class="whatif-desc">Model a refinance or balance transfer: change the APR on one debt and compare. Nothing is saved to your debts.</p>
            <div class="whatif-refi-controls">
                <div class="whatif-refi-field">
                    <label for="refiDebtSelect">Debt</label>
                    <select id="refiDebtSelect"><option value="">Select a debt…</option>${refiOptions}</select>
                </div>
                <div class="whatif-refi-field">
                    <label for="refiAprInput">New APR %</label>
                    <input type="number" id="refiAprInput" min="0" max="100" step="any" inputmode="decimal" aria-describedby="refiResult">
                </div>
                <button type="button" class="btn btn-secondary" id="refiClearBtn" aria-label="Clear refinancing scenario">Clear</button>
            </div>
            <div id="refiResult" aria-live="polite"><p class="whatif-hint">Pick a debt and enter a new APR to compare.</p></div>
        </details>
    </div>`;
    wireRefinanceSection(app, basePayment, strategy);

    const slider = document.getElementById('whatifSlider');
    const extraAmtEl = document.getElementById('whatifExtraAmt');
    const resultDiv = document.getElementById('whatifResult');

    // The full payoff simulation (DebtCalculator.calculatePaymentPlan) is
    // real work -- a bare `input` listener would re-run it many times per
    // second while dragging. The extra-amount label stays on every event
    // for responsive visual feedback; only the simulation itself is
    // debounced (see docs/audit/performance/PERFORMANCE_AUDIT_2026-09-02.md).
    const runSimulation = debounce((extra) => {
        if (extra === 0) {
            resultDiv.innerHTML = '<p class="whatif-hint">Move the slider to simulate a higher payment.</p>';
            return;
        }
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, basePayment + extra, strategy, stimulus);
            const s = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            const monthsSaved = Math.max(0, baseSummary.monthsToPayOff - s.monthsToPayOff);
            const interestSaved = Math.max(0, baseSummary.totalInterest - s.totalInterest);
            // #427: one-line plain-language headline above the detailed metrics.
            const headline = (interestSaved > 0 || monthsSaved > 0)
                ? `Saves ${formatCurrency(interestSaved)} interest \u00b7 ${monthsSaved} month${monthsSaved === 1 ? '' : 's'} sooner`
                : 'No change to payoff at this amount';
            resultDiv.innerHTML = `<p class="whatif-headline" id="whatifHeadline" role="status">${escapeHtml(headline)}</p><div class="whatif-metrics">
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
    }, 150);

    slider.addEventListener('input', () => {
        const extra = parseInt(slider.value, 10);
        extraAmtEl.textContent = formatCurrency(extra);
        runSimulation(extra);
    });
}
