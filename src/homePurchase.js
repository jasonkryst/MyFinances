// Home Purchase Planning (#249) — a Savings sub-tab surfacing the data the
// app already tracks (income, DTI inputs, a sinking-fund-style goal) in the
// specific context of planning a home purchase: a down payment goal
// tracker, a mortgage affordability calculator, a PMI threshold tracker,
// and a "debts to clear before qualifying" panel.
//
// Local/session storage only for now (see storage.js/sanitizers.js) — no
// Postgres-backend wiring, matching the issue's own file list.

import { formatCurrency, normalizeText, sanitizeFiniteNumber, escapeHtml, computeMonthlyIncomeForMonth } from './utils.js';
import { mortgageFrontEndStatus, mortgageBackEndStatus } from './health.js';
import { showAlertModal, showDeleteConfirmModal } from './ui.js';

// Midpoint of the 0.5%-1.5% typical annual PMI-rate range (see issue notes).
const PMI_ANNUAL_RATE = 0.01;
// Conventional back-end DTI ceiling used by the "debts to clear" panel —
// same threshold mortgageBackEndStatus() turns red at.
const CONVENTIONAL_BACK_END_CEILING = 0.43;

function computeDownPaymentProgress(plan) {
    const targetDownPayment = plan.targetHomePrice * (plan.targetDownPaymentPct / 100);
    const remaining = Math.max(0, targetDownPayment - plan.currentSavings);
    const progressPercent = targetDownPayment > 0 ? Math.round((plan.currentSavings / targetDownPayment) * 100) : 0;
    const monthsToGoal = plan.monthlyContribution > 0 ? Math.ceil(remaining / plan.monthlyContribution) : null;
    let projectedDate = null;
    if (monthsToGoal !== null) {
        projectedDate = new Date();
        projectedDate.setMonth(projectedDate.getMonth() + monthsToGoal);
    }
    return { targetDownPayment, remaining, progressPercent, monthsToGoal, projectedDate };
}

export function computeMortgageAffordability(app, plan) {
    const now = new Date();
    const { monthlyTotal } = computeMonthlyIncomeForMonth(app.incomes, app.bonuses, now.getFullYear(), now.getMonth());
    const totalDebtMin = (app.debts || []).filter(d => !d.archived).reduce((s, d) => s + (d.minimumPayment || 0), 0);
    const housingCost = plan.housingCostEstimate || 0;
    const frontEndRatio = monthlyTotal > 0 ? housingCost / monthlyTotal : 0;
    const backEndRatio = monthlyTotal > 0 ? (totalDebtMin + housingCost) / monthlyTotal : 0;
    return {
        monthlyIncome: monthlyTotal,
        frontEndRatio,
        backEndRatio,
        frontEndStatus: mortgageFrontEndStatus(frontEndRatio),
        backEndStatus: mortgageBackEndStatus(backEndRatio),
        totalDebtMin
    };
}

export function computePmiEstimate(plan) {
    const downPct = plan.targetDownPaymentPct;
    if (downPct >= 20) return { needsPmi: false };
    const loanAmount = plan.targetHomePrice * (1 - downPct / 100);
    const estimatedMonthlyPmi = (loanAmount * PMI_ANNUAL_RATE) / 12;
    const pctBelowTwenty = 20 - downPct;
    const dollarsToTwentyPct = plan.targetHomePrice * (pctBelowTwenty / 100);
    return { needsPmi: true, pctBelowTwenty, dollarsToTwentyPct, estimatedMonthlyPmi };
}

// Snowball order (smallest balance first, mirroring the app's existing
// Snowball payoff strategy), stopping at the first point the back-end ratio
// drops under the conventional 43% ceiling.
export function computeDebtsToClearForQualifying(app, housingCost, monthlyIncome) {
    const activeDebts = (app.debts || [])
        .filter(d => !d.archived && (d.minimumPayment || 0) > 0)
        .map(d => ({
            name: d.name || 'Debt',
            balance: d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0),
            minimumPayment: d.minimumPayment || 0
        }))
        .sort((a, b) => a.balance - b.balance);

    let remainingMin = activeDebts.reduce((s, d) => s + d.minimumPayment, 0);
    const currentRatio = monthlyIncome > 0 ? (remainingMin + housingCost) / monthlyIncome : 0;
    if (currentRatio < CONVENTIONAL_BACK_END_CEILING || activeDebts.length === 0) {
        return { alreadyQualifies: true, currentRatio, steps: [] };
    }

    const steps = [];
    for (const debt of activeDebts) {
        remainingMin -= debt.minimumPayment;
        const newRatio = monthlyIncome > 0 ? (remainingMin + housingCost) / monthlyIncome : 0;
        const qualifies = newRatio < CONVENTIONAL_BACK_END_CEILING;
        steps.push({ debtName: debt.name, balance: debt.balance, newRatio, qualifies });
        if (qualifies) break;
    }
    return { alreadyQualifies: false, currentRatio, steps };
}

function planFormHtml(plan) {
    const v = (field, fallback) => plan ? plan[field] : fallback;
    return `
    <div class="emergency-form-card">
        <div class="emergency-form-body hidden" id="hpFormBody">
            <form id="hpForm">
                <div class="emergency-form-grid">
                    <div class="form-group">
                        <label for="hpTargetPrice">Target Home Price</label>
                        <input type="number" id="hpTargetPrice" min="0" step="1000" value="${v('targetHomePrice', '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="hpDownPaymentPct">Target Down Payment %</label>
                        <input type="number" id="hpDownPaymentPct" min="0" max="100" step="0.5" value="${v('targetDownPaymentPct', 20)}">
                    </div>
                    <div class="form-group">
                        <label for="hpCurrentSavings">Current Savings Toward Down Payment</label>
                        <input type="number" id="hpCurrentSavings" min="0" step="100" value="${v('currentSavings', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpMonthlyContribution">Monthly Contribution</label>
                        <input type="number" id="hpMonthlyContribution" min="0" step="10" value="${v('monthlyContribution', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpHousingCostEstimate">Est. Monthly Housing Cost (P&amp;I + tax + insurance)</label>
                        <input type="number" id="hpHousingCostEstimate" min="0" step="10" value="${v('housingCostEstimate', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpNotes">Notes</label>
                        <textarea id="hpNotes">${plan ? escapeHtml(plan.notes || '') : ''}</textarea>
                    </div>
                </div>
                <div class="emergency-form-actions">
                    <button type="submit" class="btn btn-primary" id="hpSaveBtn">Save Plan</button>
                    ${plan ? '<button type="button" class="btn btn-secondary" id="hpCancelBtn">Cancel</button>' : ''}
                </div>
            </form>
        </div>
    </div>`;
}

export function renderHomePurchaseContent(app) {
    const plan = app.homePurchasePlan || null;

    let html = `
    <div class="hp-header">
        <h3>🏠 Home Purchase Planning</h3>
        <div class="hp-header-actions">
            <button type="button" class="emergency-form-toggle" id="hpFormToggle">${plan ? '✏️ Edit Plan' : '➕ Set Up Plan'}</button>
            ${plan ? '<button type="button" class="btn btn-secondary btn-small" id="hpClearBtn">Clear Plan</button>' : ''}
        </div>
    </div>
    ${planFormHtml(plan)}`;

    if (!plan) {
        html += '<p class="empty-message">No home purchase plan yet. Set one up to get started.</p>';
        return html;
    }

    const progress = computeDownPaymentProgress(plan);
    const afford = computeMortgageAffordability(app, plan);
    const pmi = computePmiEstimate(plan);
    const qualifying = computeDebtsToClearForQualifying(app, plan.housingCostEstimate, afford.monthlyIncome);

    const progressBadgeCls = progress.progressPercent >= 100 ? 'badge-complete'
        : progress.progressPercent >= 75 ? 'badge-excellent'
        : progress.progressPercent >= 50 ? 'badge-good' : 'badge-warning';

    html += `
    <div class="hp-card">
        <h4>Down Payment Goal</h4>
        <div class="detail-row">
            <span>${formatCurrency(plan.currentSavings)} / ${formatCurrency(progress.targetDownPayment)}</span>
            <span class="emergency-badge ${progressBadgeCls}">${progress.progressPercent}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" data-progress-width="${Math.min(100, progress.progressPercent)}"></div></div>
        <div class="detail-row"><span>Remaining:</span><span>${formatCurrency(progress.remaining)}</span></div>
        <div class="detail-row"><span>Monthly Contribution:</span><span>${formatCurrency(plan.monthlyContribution)}</span></div>
        <div class="detail-row"><span>Projected Completion:</span><span>${progress.projectedDate ? progress.projectedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}</span></div>
    </div>

    <div class="hp-card">
        <h4>Mortgage Affordability</h4>
        <div class="detail-row">
            <span>Front-End (housing &divide; income)</span>
            <span class="health-badge ${afford.frontEndStatus.cls}">${(afford.frontEndRatio * 100).toFixed(1)}%</span>
        </div>
        <div class="detail-row">
            <span>Back-End (all debt + housing &divide; income)</span>
            <span class="health-badge ${afford.backEndStatus.cls}">${(afford.backEndRatio * 100).toFixed(1)}%</span>
        </div>
    </div>

    <div class="hp-card">
        <h4>PMI Threshold</h4>
        ${pmi.needsPmi ? `
            <div class="detail-row"><span>Below 20% down by:</span><span>${pmi.pctBelowTwenty.toFixed(1)} pts (${formatCurrency(pmi.dollarsToTwentyPct)})</span></div>
            <div class="detail-row"><span>Est. Monthly PMI:</span><span>${formatCurrency(pmi.estimatedMonthlyPmi)}</span></div>
        ` : `<p class="hp-pmi-clear">✅ No PMI required at ${plan.targetDownPaymentPct}% down.</p>`}
    </div>

    <div class="hp-card" id="hpQualifyingCard">
        <h4>Debts to Clear Before Qualifying</h4>
        ${qualifying.alreadyQualifies
            ? '<p class="hp-pmi-clear">✅ You already qualify under the 43% conventional back-end threshold.</p>'
            : qualifying.steps.map(s => `
                <div class="detail-row">
                    <span>${escapeHtml(s.debtName)} (${formatCurrency(s.balance)})</span>
                    <span class="${s.qualifies ? 'hp-qualifies' : ''}">New back-end: ${(s.newRatio * 100).toFixed(1)}%${s.qualifies ? ' ✅' : ''}</span>
                </div>`).join('')}
    </div>`;

    return html;
}

async function saveHomePurchasePlan(app) {
    const targetHomePrice = sanitizeFiniteNumber(document.getElementById('hpTargetPrice').value, NaN, { min: 0 });
    if (!Number.isFinite(targetHomePrice) || targetHomePrice <= 0) {
        await showAlertModal('Please enter a target home price.');
        return;
    }
    app.homePurchasePlan = {
        targetHomePrice,
        targetDownPaymentPct: sanitizeFiniteNumber(document.getElementById('hpDownPaymentPct').value, 20, { min: 0, max: 100 }),
        currentSavings: sanitizeFiniteNumber(document.getElementById('hpCurrentSavings').value, 0, { min: 0 }),
        monthlyContribution: sanitizeFiniteNumber(document.getElementById('hpMonthlyContribution').value, 0, { min: 0 }),
        housingCostEstimate: sanitizeFiniteNumber(document.getElementById('hpHousingCostEstimate').value, 0, { min: 0 }),
        notes: normalizeText(document.getElementById('hpNotes').value, 500)
    };
    app.saveToStorage();
    app.renderSavingsPage();
    app.attachSavingsEventListeners();
}

async function clearHomePurchasePlan(app) {
    if (!await showDeleteConfirmModal('Clear your home purchase plan? This cannot be undone.')) return;
    app.homePurchasePlan = null;
    app.saveToStorage();
    app.renderSavingsPage();
    app.attachSavingsEventListeners();
}

export function attachHomePurchaseEventListeners(app) {
    const toggle = document.getElementById('hpFormToggle');
    const body = document.getElementById('hpFormBody');
    if (toggle && body) {
        toggle.addEventListener('click', () => {
            body.classList.toggle('visible');
            body.classList.toggle('hidden');
        });
    }
    const cancelBtn = document.getElementById('hpCancelBtn');
    if (cancelBtn && body) {
        cancelBtn.addEventListener('click', () => {
            body.classList.remove('visible');
            body.classList.add('hidden');
        });
    }
    const form = document.getElementById('hpForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveHomePurchasePlan(app);
        });
    }
    const clearBtn = document.getElementById('hpClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => clearHomePurchasePlan(app));
    }
}
