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
import { t } from './i18n.js';
import { formatMonthYear } from './utils.js';

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
            name: d.name || t('homePurchase.debtFallback'),
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
                        <label for="hpTargetPrice">${t('homePurchase.targetPriceLabel')}</label>
                        <input type="number" id="hpTargetPrice" min="0" step="1000" value="${v('targetHomePrice', '')}" required>
                    </div>
                    <div class="form-group">
                        <label for="hpDownPaymentPct">${t('homePurchase.downPaymentPctLabel')}</label>
                        <input type="number" id="hpDownPaymentPct" min="0" max="100" step="0.5" value="${v('targetDownPaymentPct', 20)}">
                    </div>
                    <div class="form-group">
                        <label for="hpCurrentSavings">${t('homePurchase.currentSavingsLabel')}</label>
                        <input type="number" id="hpCurrentSavings" min="0" step="100" value="${v('currentSavings', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpMonthlyContribution">${t('homePurchase.monthlyContributionLabel')}</label>
                        <input type="number" id="hpMonthlyContribution" min="0" step="10" value="${v('monthlyContribution', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpHousingCostEstimate">${t('homePurchase.housingCostLabel')}</label>
                        <input type="number" id="hpHousingCostEstimate" min="0" step="10" value="${v('housingCostEstimate', 0)}">
                    </div>
                    <div class="form-group">
                        <label for="hpNotes">${t('homePurchase.notesLabel')}</label>
                        <textarea id="hpNotes">${plan ? escapeHtml(plan.notes || '') : ''}</textarea>
                    </div>
                </div>
                <div class="emergency-form-actions">
                    <button type="submit" class="btn btn-primary" id="hpSaveBtn">${t('homePurchase.savePlan')}</button>
                    ${plan ? `<button type="button" class="btn btn-secondary" id="hpCancelBtn">${t('common.cancel')}</button>` : ''}
                </div>
            </form>
        </div>
    </div>`;
}

export function renderHomePurchaseContent(app) {
    const plan = app.homePurchasePlan || null;

    let html = `
    <div class="hp-header">
        <h3>🏠 ${t('homePurchase.title')}</h3>
        <div class="hp-header-actions">
            <button type="button" class="emergency-form-toggle" id="hpFormToggle">${plan ? `✏️ ${t('homePurchase.editPlan')}` : `➕ ${t('homePurchase.setUpPlan')}`}</button>
            ${plan ? `<button type="button" class="btn btn-secondary btn-small" id="hpClearBtn">${t('homePurchase.clearPlan')}</button>` : ''}
        </div>
    </div>
    ${planFormHtml(plan)}`;

    if (!plan) {
        html += `<p class="empty-message">${t('homePurchase.empty')}</p>`;
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
        <h4>${t('homePurchase.downPaymentGoal')}</h4>
        <div class="detail-row">
            <span>${formatCurrency(plan.currentSavings)} / ${formatCurrency(progress.targetDownPayment)}</span>
            <span class="emergency-badge ${progressBadgeCls}">${progress.progressPercent}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" data-progress-width="${Math.min(100, progress.progressPercent)}"></div></div>
        <div class="detail-row"><span>${t('homePurchase.remaining')}</span><span>${formatCurrency(progress.remaining)}</span></div>
        <div class="detail-row"><span>${t('homePurchase.monthlyContribution')}</span><span>${formatCurrency(plan.monthlyContribution)}</span></div>
        <div class="detail-row"><span>${t('homePurchase.projectedCompletion')}</span><span>${progress.projectedDate ? formatMonthYear(progress.projectedDate) : t('homePurchase.notAvailable')}</span></div>
    </div>

    <div class="hp-card">
        <h4>${t('homePurchase.affordability')}</h4>
        <div class="detail-row">
            <span>${t('homePurchase.frontEnd')}</span>
            <span class="health-badge ${afford.frontEndStatus.cls}">${(afford.frontEndRatio * 100).toFixed(1)}%</span>
        </div>
        <div class="detail-row">
            <span>${t('homePurchase.backEnd')}</span>
            <span class="health-badge ${afford.backEndStatus.cls}">${(afford.backEndRatio * 100).toFixed(1)}%</span>
        </div>
    </div>

    <div class="hp-card">
        <h4>${t('homePurchase.pmiTitle')}</h4>
        ${pmi.needsPmi ? `
            <div class="detail-row"><span>${t('homePurchase.pmiBelow')}</span><span>${t('homePurchase.pmiBelowValue', { pts: pmi.pctBelowTwenty.toFixed(1), amount: formatCurrency(pmi.dollarsToTwentyPct) })}</span></div>
            <div class="detail-row"><span>${t('homePurchase.pmiMonthly')}</span><span>${formatCurrency(pmi.estimatedMonthlyPmi)}</span></div>
        ` : `<p class="hp-pmi-clear">✅ ${t('homePurchase.pmiNone', { pct: plan.targetDownPaymentPct })}</p>`}
    </div>

    <div class="hp-card" id="hpQualifyingCard">
        <h4>${t('homePurchase.qualifyingTitle')}</h4>
        ${qualifying.alreadyQualifies
            ? `<p class="hp-pmi-clear">✅ ${t('homePurchase.alreadyQualify')}</p>`
            : qualifying.steps.map(s => `
                <div class="detail-row">
                    <span>${escapeHtml(s.debtName)} (${formatCurrency(s.balance)})</span>
                    <span class="${s.qualifies ? 'hp-qualifies' : ''}">${t('homePurchase.newBackEnd', { pct: (s.newRatio * 100).toFixed(1) })}${s.qualifies ? ' ✅' : ''}</span>
                </div>`).join('')}
    </div>`;

    return html;
}

async function saveHomePurchasePlan(app) {
    const targetHomePrice = sanitizeFiniteNumber(document.getElementById('hpTargetPrice').value, NaN, { min: 0 });
    if (!Number.isFinite(targetHomePrice) || targetHomePrice <= 0) {
        await showAlertModal(t('homePurchase.errTargetPrice'));
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
    if (!await showDeleteConfirmModal(t('homePurchase.confirmClear'))) return;
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
