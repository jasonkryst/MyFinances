// Strategy comparison + what-if simulator feature module

import {
    formatCurrency,
    formatLongDate,
    escapeHtml,
    debounce
} from './utils.js';
import { t, plural } from './i18n.js';
import { strategyLabel } from './strategy.js';

/**
 * Render strategy interest comparison panel.
 */
export function displayInterestComparison(app, currentStrategy, monthlyPayment) {
    const container = document.getElementById('interestComparison');
    if (!container || !monthlyPayment || isNaN(monthlyPayment)) { if (container) container.innerHTML = ''; return; }

    const strategies = [
        { key: 'avalanche', label: strategyLabel('avalanche') },
        { key: 'snowball', label: strategyLabel('snowball') },
        { key: 'priority-lowest', label: strategyLabel('priority-lowest') },
        { key: 'priority-highest', label: strategyLabel('priority-highest') }
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

    let html = `<div class="interest-comparison"><h4>📊 ${escapeHtml(t('strategy.cmpTitle'))}</h4>`;
    if (interestSaved > 0.5) {
        const vars = { strategy: best.label, amount: formatCurrency(interestSaved) };
        const msg = monthsSaved > 0 ? plural('strategy.cmpSavesMonths', monthsSaved, vars) : t('strategy.cmpSaves', vars);
        html += `<div class="comparison-banner">${escapeHtml(msg)}</div>`;
    } else {
        html += `<div class="comparison-banner comparison-banner--good">✅ ${escapeHtml(t('strategy.cmpAlreadyBest'))}</div>`;
    }
    html += `<div class="table-wrapper"><table class="comparison-table">
        <thead><tr><th>${escapeHtml(t('strategy.cmpColStrategy'))}</th><th>${escapeHtml(t('strategy.totalInterest'))}</th><th>${escapeHtml(t('strategy.cmpColMonths'))}</th><th>${escapeHtml(t('strategy.cmpColExtra'))}</th></tr></thead><tbody>`;
    for (const r of results) {
        const diff = r.totalInterest - best.totalInterest;
        html += `<tr class="${r.isCurrent ? 'comparison-current' : ''}">
            <td>${r.label}
                ${r.isCurrent ? `<span class="strat-badge strat-badge--current">${escapeHtml(t('strategy.cmpCurrent'))}</span>` : ''}
                ${r.key === best.key ? `<span class="strat-badge strat-badge--best">${escapeHtml(t('strategy.cmpBest'))}</span>` : ''}
            </td>
            <td>${formatCurrency(r.totalInterest)}</td>
            <td>${escapeHtml(t('strategy.moShort', { count: r.months }))}</td>
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
    if (!target) throw new Error(t('strategy.refiPickError'));
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
    if (result) result.innerHTML = `<p class="whatif-hint">${escapeHtml(t('strategy.refiHint'))}</p>`;
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
            result.innerHTML = `<p class="whatif-hint">${escapeHtml(t('strategy.refiHint'))}</p>`;
            return;
        }
        if (aprInput.value.trim() === '') {
            result.innerHTML = `<p class="whatif-hint">${escapeHtml(t('strategy.refiEnterApr'))}</p>`;
            return;
        }
        const newApr = parseRefinanceApr(aprInput.value);
        if (newApr === null) { showError(t('strategy.refiAprRange')); return; }
        let r;
        try {
            r = computeRefinanceScenario(app, basePayment, strategy, sel.value, newApr);
        } catch (e) {
            showError(e && e.message ? e.message : String(e));
            return;
        }
        if (newApr === r.oldApr) {
            result.innerHTML = `<p class="whatif-hint" id="refiNoChange">${escapeHtml(t('strategy.refiNoChange', { name: r.debt.name, apr: r.oldApr }))}</p>`;
            return;
        }
        const saved = r.interestDelta >= 0;
        const monthsText = r.monthsDelta === 0 ? '0' : (r.monthsDelta > 0 ? t('strategy.refiMonthsSooner', { count: r.monthsDelta }) : t('strategy.refiMonthsLater', { count: -r.monthsDelta }));
        result.innerHTML = `<div class="whatif-metrics">
            <div class="whatif-metric">
                <div class="whatif-metric-label">${escapeHtml(t('strategy.refiPayoffCurrent'))}</div>
                <div class="whatif-metric-val">${formatLongDate(r.current.payOffDate)}</div>
            </div>
            <div class="whatif-metric ${r.monthsDelta >= 0 ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label">${escapeHtml(t('strategy.refiPayoffNew'))}</div>
                <div class="whatif-metric-val" id="refiNewDate">${formatLongDate(r.scenario.payOffDate)}</div>
            </div>
            <div class="whatif-metric ${r.monthsDelta >= 0 ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label">${escapeHtml(t('strategy.monthsSaved'))}</div>
                <div class="whatif-metric-val" id="refiMonths">${escapeHtml(monthsText)}</div>
            </div>
            <div class="whatif-metric ${saved ? 'whatif-metric--good' : ''}">
                <div class="whatif-metric-label" id="refiInterestLabel">${escapeHtml(t(saved ? 'strategy.interestSaved' : 'strategy.refiExtraCost'))}</div>
                <div class="whatif-metric-val" id="refiInterest">${formatCurrency(Math.abs(r.interestDelta))}</div>
            </div>
            <div class="whatif-metric">
                <div class="whatif-metric-label">${escapeHtml(t('strategy.whatifNewTotal'))}</div>
                <div class="whatif-metric-val">${formatCurrency(r.scenario.totalInterest)}</div>
            </div>
        </div>
        <p class="whatif-hint" id="refiPaymentNote">${escapeHtml(t('strategy.refiNote', { name: r.debt.name, old: r.oldApr, new: newApr, payment: formatCurrency(basePayment), min: formatCurrency(r.debt.minimumPayment || 0) }))}</p>`;
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
        .map(d => `<option value="${escapeHtml(String(d.id))}">${escapeHtml(t('strategy.refiOption', { name: d.name, rate: String(d.interestRate || 0) }))}</option>`)
        .join('');

    container.innerHTML = `<div class="whatif-panel">
        <h4>🔧 ${escapeHtml(t('strategy.whatifTitle'))}</h4>
        <p class="whatif-desc">${escapeHtml(t('strategy.whatifDesc'))}</p>
        <div class="whatif-slider-row">
            <span class="whatif-slider-label"><span>${escapeHtml(t('strategy.whatifExtraPerMo'))}</span> <strong id="whatifExtraAmt">${formatCurrency(0)}</strong></span>
            <input type="range" id="whatifSlider" min="0" max="${sliderMax}" step="10" value="0" aria-label="${escapeHtml(t('strategy.whatifSliderAria'))}">
            <span class="whatif-slider-cap">+${formatCurrency(sliderMax)}</span>
        </div>
        <div id="whatifResult"><p class="whatif-hint">${escapeHtml(t('strategy.whatifHint'))}</p></div>
        <details class="whatif-refi" id="refiDetails">
            <summary>${escapeHtml(t('strategy.refiSummary'))}</summary>
            <p class="whatif-desc">${escapeHtml(t('strategy.refiDesc'))}</p>
            <div class="whatif-refi-controls">
                <div class="whatif-refi-field">
                    <label for="refiDebtSelect">${escapeHtml(t('strategy.refiDebtLabel'))}</label>
                    <select id="refiDebtSelect"><option value="">${escapeHtml(t('strategy.refiSelectDebt'))}</option>${refiOptions}</select>
                </div>
                <div class="whatif-refi-field">
                    <label for="refiAprInput">${escapeHtml(t('strategy.refiAprLabel'))}</label>
                    <input type="number" id="refiAprInput" min="0" max="100" step="any" inputmode="decimal" aria-describedby="refiResult">
                </div>
                <button type="button" class="btn btn-secondary" id="refiClearBtn" aria-label="${escapeHtml(t('strategy.refiClearAria'))}">${escapeHtml(t('strategy.refiClear'))}</button>
            </div>
            <div id="refiResult" aria-live="polite"><p class="whatif-hint">${escapeHtml(t('strategy.refiHint'))}</p></div>
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
            resultDiv.innerHTML = `<p class="whatif-hint">${escapeHtml(t('strategy.whatifHint'))}</p>`;
            return;
        }
        try {
            const r = DebtCalculator.calculatePaymentPlan(app.debts, basePayment + extra, strategy, stimulus);
            const s = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            const monthsSaved = Math.max(0, baseSummary.monthsToPayOff - s.monthsToPayOff);
            const interestSaved = Math.max(0, baseSummary.totalInterest - s.totalInterest);
            // #427: one-line plain-language headline above the detailed metrics.
            const headline = (interestSaved > 0 || monthsSaved > 0)
                ? plural('strategy.whatifHeadline', monthsSaved, { interest: formatCurrency(interestSaved) })
                : t('strategy.whatifNoChange');
            resultDiv.innerHTML = `<p class="whatif-headline" id="whatifHeadline" role="status">${escapeHtml(headline)}</p><div class="whatif-metrics">
                <div class="whatif-metric">
                    <div class="whatif-metric-label">${escapeHtml(t('strategy.whatifNewPayoff'))}</div>
                    <div class="whatif-metric-val">${formatLongDate(s.payOffDate)}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">${escapeHtml(t('strategy.monthsSaved'))}</div>
                    <div class="whatif-metric-val">${monthsSaved}</div>
                </div>
                <div class="whatif-metric whatif-metric--good">
                    <div class="whatif-metric-label">${escapeHtml(t('strategy.interestSaved'))}</div>
                    <div class="whatif-metric-val">${formatCurrency(interestSaved)}</div>
                </div>
                <div class="whatif-metric">
                    <div class="whatif-metric-label">${escapeHtml(t('strategy.whatifNewTotal'))}</div>
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
