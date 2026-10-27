// Retirement accounts: history log, projection, and page rendering.

import {
    computeRetirementProjection, computePensionContributionProjection, splitGrowthFromContribution,
    getContributionLimit, computeYtdContributions, computeMonthlyWithdrawal,
    computeScenarioRates, computeRetirementProjectionScenarios, computeRetirementProjectionSeries,
    DEFAULT_CONSERVATIVE_DELTA, DEFAULT_AGGRESSIVE_DELTA
} from './retirementCalculator.js';
import { pgPost, pgDelete, pgPatch } from './postgresSync.js';
import { formatCurrency, escapeHtml, todayISO, renderChartDataTable } from './utils.js';
import {
    getSetting, setSetting, RETIREMENT_WITHDRAWAL_RATE,
    RETIREMENT_SCENARIO_CONSERVATIVE_DELTA, RETIREMENT_SCENARIO_AGGRESSIVE_DELTA
} from './settings.js';
import { t } from './i18n.js';

// Bounds enforced on the user-editable scenario deltas: a conservative
// scenario can never be more optimistic than moderate, and vice versa.
const CONSERVATIVE_DELTA_MIN = -20;
const CONSERVATIVE_DELTA_MAX = 0;
const AGGRESSIVE_DELTA_MIN = 0;
const AGGRESSIVE_DELTA_MAX = 20;

function clampConservativeDelta(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_CONSERVATIVE_DELTA;
    return Math.min(CONSERVATIVE_DELTA_MAX, Math.max(CONSERVATIVE_DELTA_MIN, n));
}

function clampAggressiveDelta(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_AGGRESSIVE_DELTA;
    return Math.min(AGGRESSIVE_DELTA_MAX, Math.max(AGGRESSIVE_DELTA_MIN, n));
}

function getScenarioDeltas(app) {
    return {
        conservativeDelta: clampConservativeDelta(getSetting(app, RETIREMENT_SCENARIO_CONSERVATIVE_DELTA, DEFAULT_CONSERVATIVE_DELTA)),
        aggressiveDelta: clampAggressiveDelta(getSetting(app, RETIREMENT_SCENARIO_AGGRESSIVE_DELTA, DEFAULT_AGGRESSIVE_DELTA)),
    };
}

export function getRetirementAccounts(app) {
    return (app.accounts || []).filter(a => a.type === 'Retirement');
}

export function getSnapshotsForAccount(app, accountId) {
    return (app.retirementSnapshots || [])
        .filter(s => s.accountId === accountId)
        .sort((a, b) => a.date.localeCompare(b.date));
}

// annualSalary is only populated for pension accounts; balance/contribution remain 0 for those.
export async function addRetirementSnapshot(app, accountId, date, balance, contribution, annualSalary = null) {
    const snapshot = { id: Date.now(), accountId, date, balance, contribution, annualSalary };
    app.retirementSnapshots.push(snapshot);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/retirement-snapshots', snapshot);
        if (saved?.id) snapshot.id = saved.id;
    }
    app.renderRetirementPage();
}

export function deleteRetirementSnapshot(app, id) {
    app.retirementSnapshots = app.retirementSnapshots.filter(s => s.id !== id);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/retirement-snapshots/${id}`);
    app.renderRetirementPage();
}

// Projects an account's value at app.retirementTargetDate.
// Investment accounts (401k, IRA, etc.): compounds balance with rate of return.
// Pension accounts: projects total employee contributions accumulated by the target date.
// Returns null if no target date is set or the account doesn't exist.
export function computeAccountProjection(app, accountId) {
    if (!app.retirementTargetDate) return null;
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );

    if (account.retirementSubtype === 'Pension') {
        const snapshots = getSnapshotsForAccount(app, accountId);
        const latest = snapshots[snapshots.length - 1];
        const latestSalary = latest?.annualSalary != null ? latest.annualSalary : (Number(account.pensionAnnualSalary) || 0);
        return computePensionContributionProjection(latestSalary, Number(account.pensionContributionRatePct) || 0, monthsUntilTarget);
    }

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const lastContribution = latest ? latest.contribution : 0;
    const employerMultiplier = 1 + (Number(account.employerMatchPercent) || 0) / 100;
    const monthlyContribution = lastContribution * employerMultiplier;

    return computeRetirementProjection(currentBalance, monthlyContribution, Number(account.rateOfReturn) || 0, monthsUntilTarget);
}

// Current-balance/monthly-contribution inputs for a (non-pension) account's
// projection — shared by computeAccountProjection (above), the scenario band,
// and the combined projection chart series, so all three stay in sync.
function getAccountProjectionInputs(app, account) {
    const snapshots = getSnapshotsForAccount(app, account.id);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const lastContribution = latest ? latest.contribution : 0;
    const employerMultiplier = 1 + (Number(account.employerMatchPercent) || 0) / 100;
    return { currentBalance, monthlyContribution: lastContribution * employerMultiplier };
}

// Conservative/moderate/aggressive projection band for a single account
// (issue #264). Pension accounts have no rate-of-return to vary, so all
// three scenarios equal the account's existing (rate-independent) projection.
// Investment accounts: moderate is computeAccountProjection(app, accountId)
// itself (guarantees parity with the existing single-scenario number);
// conservative/aggressive derive from the account's own rateOfReturn via
// computeScenarioRates. Returns null under the same conditions as
// computeAccountProjection (no target date / unknown account).
export function computeAccountProjectionScenarios(app, accountId, conservativeDelta, aggressiveDelta) {
    if (!app.retirementTargetDate) return null;
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const moderate = computeAccountProjection(app, accountId);

    if (account.retirementSubtype === 'Pension') {
        return { conservative: moderate, moderate, aggressive: moderate, rates: { conservative: null, moderate: null, aggressive: null } };
    }

    const { conservativeDelta: cDeltaDefault, aggressiveDelta: aDeltaDefault } = getScenarioDeltas(app);
    const cDelta = conservativeDelta != null ? conservativeDelta : cDeltaDefault;
    const aDelta = aggressiveDelta != null ? aggressiveDelta : aDeltaDefault;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );
    const { currentBalance, monthlyContribution } = getAccountProjectionInputs(app, account);
    const rates = computeScenarioRates(Number(account.rateOfReturn) || 0, cDelta, aDelta);

    return {
        conservative: computeRetirementProjection(currentBalance, monthlyContribution, rates.conservative, monthsUntilTarget),
        moderate,
        aggressive: computeRetirementProjection(currentBalance, monthlyContribution, rates.aggressive, monthsUntilTarget),
        rates,
    };
}

// Sums each non-pension account's own per-scenario month-by-month series
// (not by averaging rates — different accounts can have different absolute
// conservative/aggressive rates once their own moderate rate differs).
function computeCombinedProjectionSeries(app, accounts, monthsUntilTarget, conservativeDelta, aggressiveDelta) {
    if (!(monthsUntilTarget > 0) || accounts.length === 0) return [];
    const sampleEvery = monthsUntilTarget > 120 ? 12 : (monthsUntilTarget > 24 ? 3 : 1);

    const perAccount = accounts.map(account => {
        const { currentBalance, monthlyContribution } = getAccountProjectionInputs(app, account);
        const rates = computeScenarioRates(Number(account.rateOfReturn) || 0, conservativeDelta, aggressiveDelta);
        return {
            conservative: computeRetirementProjectionSeries(currentBalance, monthlyContribution, rates.conservative, monthsUntilTarget, sampleEvery),
            moderate: computeRetirementProjectionSeries(currentBalance, monthlyContribution, rates.moderate, monthsUntilTarget, sampleEvery),
            aggressive: computeRetirementProjectionSeries(currentBalance, monthlyContribution, rates.aggressive, monthsUntilTarget, sampleEvery),
        };
    });

    const months = perAccount[0].moderate.map(p => p.month);
    return months.map((month, i) => ({
        month,
        conservative: perAccount.reduce((sum, s) => sum + (s.conservative[i]?.balance || 0), 0),
        moderate: perAccount.reduce((sum, s) => sum + (s.moderate[i]?.balance || 0), 0),
        aggressive: perAccount.reduce((sum, s) => sum + (s.aggressive[i]?.balance || 0), 0),
    }));
}

export function openRetirementSnapshotModal(app, accountId) {
    const modal = document.getElementById('retirementSnapshotModal');
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!modal || !account) return;

    const isPension = account.retirementSubtype === 'Pension';

    const titleEl = document.getElementById('retirementSnapshotModalTitle');
    const dateInput = document.getElementById('retirementSnapshotModalDate');
    const balanceInput = document.getElementById('retirementSnapshotModalBalance');
    const contributionInput = document.getElementById('retirementSnapshotModalContribution');
    const salaryInput = document.getElementById('retirementSnapshotModalAnnualSalary');
    const balanceGroup = document.getElementById('retirementSnapshotModalBalanceGroup');
    const contributionGroup = document.getElementById('retirementSnapshotModalContributionGroup');
    const salaryGroup = document.getElementById('retirementSnapshotModalSalaryGroup');
    const confirmBtn = document.getElementById('retirementSnapshotModalConfirmBtn');
    const cancelBtn = document.getElementById('retirementSnapshotModalCancelBtn');
    const closeBtn = document.getElementById('retirementSnapshotModalCloseBtn');
    if (!dateInput || !balanceInput || !contributionInput || !salaryInput || !confirmBtn || !cancelBtn || !closeBtn) return;

    if (titleEl) titleEl.textContent = isPension ? t('retirement.modalLogSalary') : t('retirement.modalLogBalance');
    balanceGroup?.classList.toggle('hidden', isPension);
    contributionGroup?.classList.toggle('hidden', isPension);
    salaryGroup?.classList.toggle('hidden', !isPension);

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    dateInput.value = todayISO();
    if (isPension) {
        salaryInput.value = latest?.annualSalary != null ? latest.annualSalary : (Number(account.pensionAnnualSalary) || 0);
    } else {
        balanceInput.value = latest ? latest.balance : (Number(account.startingBalance) || 0);
        contributionInput.value = latest ? latest.contribution : 0;
    }

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = async () => {
        if (isPension) {
            const annualSalary = Number(salaryInput.value);
            if (!Number.isFinite(annualSalary) || annualSalary < 0) return;
            const monthlyContribution = annualSalary * (Number(account.pensionContributionRatePct) || 0) / 1200;
            await app.addRetirementSnapshot(accountId, dateInput.value || todayISO(), 0, monthlyContribution, annualSalary);
        } else {
            const balance = Number(balanceInput.value);
            const contribution = Number(contributionInput.value) || 0;
            if (!Number.isFinite(balance) || balance < 0) return;
            await app.addRetirementSnapshot(accountId, dateInput.value || todayISO(), balance, contribution, null);
        }
        close();
    };
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    modal.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Enter') { event.preventDefault(); confirmBtn.click(); return; }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => balanceInput.focus(), 30);
}

function renderContributionLimitSection(app, account) {
    const subtype = account.retirementSubtype;
    const year = new Date().getFullYear();
    const limit = getContributionLimit(subtype, year, {
        catchUp: account.catchUpEligible,
        hsaFamily: account.hsaCoverageType === 'family',
    });
    if (limit === null) return ''; // Pension / Other — no statutory limit

    const ytd = computeYtdContributions(app.retirementSnapshots, account.id, year);
    const pctRaw = (ytd / limit) * 100;
    const pctClamped = Math.min(pctRaw, 100);
    const state = pctRaw >= 100 ? 'over' : pctRaw >= 80 ? 'near' : 'ok';
    const badgeHtml = state !== 'ok'
        ? `<span class="retire-limit-badge retire-limit-badge--${state}" role="status">${state === 'over' ? t('retirement.overLimit') : t('retirement.nearLimit')}</span>`
        : '';

    const catchUpToggle = `
        <label class="retire-limit-toggle">
            <input type="checkbox" data-retire-action="toggle-catchup" data-retire-account-id="${account.id}"${account.catchUpEligible ? ' checked' : ''}>
            ${t('retirement.catchUpToggle')}
        </label>`;

    const hsaToggle = subtype === 'HSA' ? `
        <label class="retire-limit-toggle">
            ${t('retirement.coverageLabel')}
            <select data-retire-action="set-hsa-coverage" data-retire-account-id="${account.id}">
                <option value="selfOnly"${account.hsaCoverageType !== 'family' ? ' selected' : ''}>${t('retirement.selfOnly')}</option>
                <option value="family"${account.hsaCoverageType === 'family' ? ' selected' : ''}>${t('retirement.family')}</option>
            </select>
        </label>` : '';

    return `
        <div class="retire-limit-section">
            <div class="retire-limit-header">
                <span class="retire-limit-title">${t('retirement.irsLimitTitle', { year })}</span>
                ${badgeHtml}
                <span class="retire-limit-controls">${catchUpToggle}${hsaToggle}</span>
            </div>
            <div class="retire-limit-bar-row">
                <div class="retire-limit-bar" role="progressbar" aria-valuenow="${Math.round(pctRaw)}" aria-valuemin="0" aria-valuemax="100" aria-label="${t('retirement.ytdContribAriaLabel')}">
                    <div class="retire-limit-fill retire-limit-fill--${state}" data-progress-width="${pctClamped}"></div>
                </div>
                <span class="retire-limit-label">${formatCurrency(ytd)} of ${formatCurrency(limit)}</span>
            </div>
        </div>`;
}

function renderAccountCard(app, account) {
    const isPension = account.retirementSubtype === 'Pension';
    const snapshots = getSnapshotsForAccount(app, account.id);
    const latest = snapshots[snapshots.length - 1];

    if (isPension) {
        const currentSalary = latest?.annualSalary != null ? latest.annualSalary : (Number(account.pensionAnnualSalary) || 0);
        const monthlyContrib = currentSalary * (Number(account.pensionContributionRatePct) || 0) / 1200;
        const rows = snapshots.length === 0
            ? `<tr><td colspan="4" class="retire-empty-msg">${t('retirement.noSalaryReviewsMsg')}</td></tr>`
            : [...snapshots].reverse().map(s => `
                <tr>
                    <td>${escapeHtml(s.date)}</td>
                    <td>${formatCurrency(s.annualSalary != null ? s.annualSalary : 0)}</td>
                    <td>${formatCurrency(s.contribution)}</td>
                    <td><button class="btn btn-danger btn-small" data-retire-action="delete-snapshot" data-retire-snapshot-id="${s.id}" aria-label="${escapeHtml(t('retirement.deleteSnapshotAria', { date: s.date }))}">${t('retirement.deleteBtn')}</button></td>
                </tr>`).join('');
        return `
            <div class="retire-card">
                <div class="retire-card-header">
                    <span class="acct-type-icon">🏛️</span>
                    <div class="acct-card-info">
                        <span class="acct-card-name">${escapeHtml(account.name)} ${t('retirement.pensionTypeLabel')}</span>
                        <span class="acct-rate-badge">💼 ${t('retirement.pensionSalaryBadge', { salary: formatCurrency(currentSalary), rate: Number(account.pensionContributionRatePct).toFixed(1) })}${Number(account.pensionVestingYears) > 0 ? ` · ${t('retirement.pensionVestsBadge', { years: account.pensionVestingYears })}` : ''}</span>
                    </div>
                    <div class="retire-stat">
                        <span class="acct-balance-label">${t('retirement.monthlyContribLabel')}</span>
                        <span class="acct-balance-value">${formatCurrency(monthlyContrib)}</span>
                    </div>
                    <button class="btn btn-primary btn-small" data-retire-action="add-snapshot" data-retire-account-id="${account.id}" aria-label="${escapeHtml(t('retirement.logSalaryReviewAria', { name: account.name }))}">${t('retirement.logSalaryReviewBtn')}</button>
                </div>
                ${Number(account.pensionEstimatedMonthlyBenefit) > 0 || Number(account.pensionYearsOfService) > 0 ? `
                <div class="retire-pension-meta">
                    ${Number(account.pensionYearsOfService) > 0 ? `<span>${t('retirement.yearsOfService')} <strong>${account.pensionYearsOfService}</strong></span>` : ''}
                    ${Number(account.pensionEstimatedMonthlyBenefit) > 0 ? `<span>${t('retirement.estMonthlyBenefit')} <strong>${formatCurrency(account.pensionEstimatedMonthlyBenefit)}</strong></span>` : ''}
                </div>` : ''}
                <div class="table-wrapper">
                    <table class="retire-snapshot-table">
                        <thead><tr><th scope="col">${t('retirement.colDate')}</th><th scope="col">${t('retirement.colAnnualSalary')}</th><th scope="col">${t('retirement.colMonthlyContrib')}</th><th scope="col"><span class="sr-only">${t('retirement.colActions')}</span></th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
    }

    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const rows = snapshots.length === 0
        ? `<tr><td colspan="4" class="retire-empty-msg">${t('retirement.noBalancesMsg')}</td></tr>`
        : [...snapshots].reverse().map(s => `
            <tr>
                <td>${escapeHtml(s.date)}</td>
                <td>${formatCurrency(s.balance)}</td>
                <td>${formatCurrency(s.contribution)}</td>
                <td><button class="btn btn-danger btn-small" data-retire-action="delete-snapshot" data-retire-snapshot-id="${s.id}" aria-label="${escapeHtml(t('retirement.deleteSnapshotAria', { date: s.date }))}">${t('retirement.deleteBtn')}</button></td>
            </tr>`).join('');

    return `
        <div class="retire-card">
            <div class="retire-card-header">
                <span class="acct-type-icon">🏛️</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${escapeHtml(account.name)} (${escapeHtml(account.retirementSubtype)})</span>
                    <span class="acct-rate-badge">📈 ${t('retirement.estReturnBadge', { rate: Number(account.rateOfReturn).toFixed(1) })}${Number(account.employerMatchPercent) > 0 ? ` · ${t('retirement.matchBadge', { pct: Number(account.employerMatchPercent).toFixed(0) })}` : ''}</span>
                </div>
                <div class="retire-stat">
                    <span class="acct-balance-label">${t('retirement.currentBalanceLabel')}</span>
                    <span class="acct-balance-value">${formatCurrency(currentBalance)}</span>
                </div>
                <button class="btn btn-primary btn-small" data-retire-action="add-snapshot" data-retire-account-id="${account.id}" aria-label="${escapeHtml(t('retirement.addSnapshotAria', { name: account.name }))}">${t('retirement.addSnapshotBtn')}</button>
            </div>
            <div class="table-wrapper">
                <table class="retire-snapshot-table">
                    <thead><tr><th scope="col">${t('retirement.colDate')}</th><th scope="col">${t('retirement.colBalance')}</th><th scope="col">${t('retirement.colContribution')}</th><th scope="col"><span class="sr-only">${t('retirement.colActions')}</span></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${renderContributionLimitSection(app, account)}
        </div>`;
}

function destroyChart(app, key) {
    if (app[key]) { app[key].destroy(); app[key] = null; }
}

function isDarkMode() { return document.body.classList.contains('dark-mode'); }

function chartColors() {
    const dark = isDarkMode();
    return { grid: dark ? '#374151' : '#e5e7eb', label: dark ? '#d1d5db' : '#374151' };
}

const ACCOUNT_LINE_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

function renderBalanceChart(app, accounts) {
    // Pension accounts don't track an investable balance — exclude them from this chart.
    accounts = accounts.filter(a => a.retirementSubtype !== 'Pension');
    const canvas = document.getElementById('retireBalanceChart');
    if (!canvas) return;
    destroyChart(app, '_retireBalanceChart');

    const allDates = [...new Set(accounts.flatMap(a => getSnapshotsForAccount(app, a.id).map(s => s.date)))].sort();
    if (allDates.length === 0) return;

    const { grid, label } = chartColors();
    const datasets = accounts.map((a, i) => {
        const byDate = Object.fromEntries(getSnapshotsForAccount(app, a.id).map(s => [s.date, s.balance]));
        return {
            label: a.name,
            data: allDates.map(d => byDate[d] ?? null),
            borderColor: ACCOUNT_LINE_COLORS[i % ACCOUNT_LINE_COLORS.length],
            spanGaps: true,
            tension: 0.3,
            pointRadius: 3
        };
    });

    app._retireBalanceChart = new Chart(canvas, {
        type: 'line',
        data: { labels: allDates, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireBalanceChart', {
        caption: t('retirement.a11yBalanceCaption'),
        columns: [t('retirement.colDate'), ...accounts.map(a => a.name)],
        rows: allDates.map((d, i) => [d, ...datasets.map(ds => ds.data[i] != null ? formatCurrency(ds.data[i]) : '—')])
    });
}

function renderContributionChart(app, accounts) {
    // Pension contributions are salary-derived and don't have market growth — exclude them here.
    accounts = accounts.filter(a => a.retirementSubtype !== 'Pension');
    const canvas = document.getElementById('retireContributionChart');
    if (!canvas) return;
    destroyChart(app, '_retireContributionChart');

    const byDate = new Map();
    for (const account of accounts) {
        const split = splitGrowthFromContribution(getSnapshotsForAccount(app, account.id));
        for (const row of split) {
            const entry = byDate.get(row.date) || { contribution: 0, growth: 0 };
            entry.contribution += row.contribution;
            entry.growth += row.growth;
            byDate.set(row.date, entry);
        }
    }
    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) return;

    const { grid, label } = chartColors();
    const contributionData = dates.map(d => byDate.get(d).contribution);
    const growthData = dates.map(d => byDate.get(d).growth);

    app._retireContributionChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [
                { label: t('retirement.colContribution'), data: contributionData, backgroundColor: '#2563eb', stack: 's', borderRadius: 4 },
                { label: t('retirement.a11yGrowthCol'), data: growthData, backgroundColor: '#10b981', stack: 's', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { stacked: true, ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { stacked: true, ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireContributionChart', {
        caption: t('retirement.a11yContribCaption'),
        columns: [t('retirement.colDate'), t('retirement.colContribution'), t('retirement.a11yGrowthCol')],
        rows: dates.map((d, i) => [d, formatCurrency(contributionData[i]), formatCurrency(growthData[i])])
    });
}

function renderBreakdownChart(app, accounts) {
    // Pension accounts don't contribute a market balance — exclude them from the balance breakdown.
    accounts = accounts.filter(a => a.retirementSubtype !== 'Pension');
    const canvas = document.getElementById('retireBreakdownChart');
    if (!canvas) return;
    destroyChart(app, '_retireBreakdownChart');

    const balances = accounts.map(a => {
        const snaps = getSnapshotsForAccount(app, a.id);
        return snaps.length > 0 ? snaps[snaps.length - 1].balance : (Number(a.startingBalance) || 0);
    });
    if (balances.every(b => b <= 0)) return;

    const { label } = chartColors();
    app._retireBreakdownChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: accounts.map(a => a.name), datasets: [{ data: balances, backgroundColor: ACCOUNT_LINE_COLORS }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.parsed)}` } } }
        }
    });

    renderChartDataTable('retireBreakdownChart', {
        caption: t('retirement.a11yBreakdownCaption'),
        columns: [t('retirement.a11yAccountCol'), t('retirement.colBalance')],
        rows: accounts.map((a, i) => [a.name, formatCurrency(balances[i])])
    });
}

// Three-line conservative/moderate/aggressive projection chart to
// app.retirementTargetDate (issue #264). Pension accounts have no
// rate-driven growth to project, so they're excluded here — same convention
// as the other three charts.
function renderProjectionChart(app, accounts, conservativeDelta, aggressiveDelta) {
    const canvas = document.getElementById('retireProjectionChart');
    if (!canvas) return;
    destroyChart(app, '_retireProjectionChart');

    const investAccounts = accounts.filter(a => a.retirementSubtype !== 'Pension');
    if (investAccounts.length === 0 || !app.retirementTargetDate) return;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );
    if (!(monthsUntilTarget > 0)) return;

    const series = computeCombinedProjectionSeries(app, investAccounts, monthsUntilTarget, conservativeDelta, aggressiveDelta);
    if (series.length === 0) return;

    const today = new Date();
    const labels = series.map(p => {
        const d = new Date(today.getFullYear(), today.getMonth() + p.month, 1);
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    const { grid, label } = chartColors();
    app._retireProjectionChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: t('retirement.scenarioConservative'), data: series.map(p => p.conservative), borderColor: '#dc2626', backgroundColor: '#dc2626', tension: 0.25, pointRadius: 2, fill: false },
                { label: t('retirement.scenarioModerate'), data: series.map(p => p.moderate), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.25, pointRadius: 2, fill: false },
                { label: t('retirement.scenarioAggressive'), data: series.map(p => p.aggressive), borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.25, pointRadius: 2, fill: false },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireProjectionChart', {
        caption: t('retirement.a11yProjectionCaption'),
        columns: [t('retirement.colDate'), t('retirement.scenarioConservative'), t('retirement.scenarioModerate'), t('retirement.scenarioAggressive')],
        rows: series.map((p, i) => [labels[i], formatCurrency(p.conservative), formatCurrency(p.moderate), formatCurrency(p.aggressive)])
    });
}

function renderProjectionPanel(app, accounts) {
    const panel = document.getElementById('retireProjectionPanel');
    if (!panel) return;

    if (!app.retirementTargetDate) {
        panel.innerHTML = `<p class="retire-empty-msg">${t('retirement.noTargetDateMsg')}</p>`;
        return;
    }

    const rows = accounts.map(a => {
        // Local call, not app.computeAccountProjection(): this module is
        // already loaded and executing, and the app wrapper is async
        // (issue #278) -- going through it here would hand back a Promise
        // instead of the synchronous number formatCurrency()/the sum below need.
        const projected = computeAccountProjection(app, a.id);
        const label = a.retirementSubtype === 'Pension'
            ? `${escapeHtml(a.name)} ${t('retirement.pensionTotalContribLabel')}`
            : escapeHtml(a.name);
        return `<div class="acct-balance-item"><span class="acct-balance-label">${label}</span><span class="acct-balance-value">${formatCurrency(projected)}</span></div>`;
    });
    const total = accounts.reduce((sum, a) => sum + (computeAccountProjection(app, a.id) || 0), 0);

    const withdrawalRate = Number(getSetting(app, RETIREMENT_WITHDRAWAL_RATE, 4)) || 4;
    const { conservativeDelta, aggressiveDelta } = getScenarioDeltas(app);

    // Multi-scenario band (issue #264): per-account + combined totals for all
    // three scenarios, feeding both the scenario summary table and the
    // withdrawal-estimate row below.
    const scenarioByAccount = accounts.map(a => ({
        account: a,
        scenarios: computeAccountProjectionScenarios(app, a.id, conservativeDelta, aggressiveDelta)
    }));
    const scenarioTotal = scenarioByAccount.reduce((sum, { scenarios }) => ({
        conservative: sum.conservative + (scenarios?.conservative || 0),
        moderate: sum.moderate + (scenarios?.moderate || 0),
        aggressive: sum.aggressive + (scenarios?.aggressive || 0),
    }), { conservative: 0, moderate: 0, aggressive: 0 });

    const scenarioRows = scenarioByAccount.map(({ account: a, scenarios: s }) => {
        const label = a.retirementSubtype === 'Pension'
            ? `${escapeHtml(a.name)} ${t('retirement.pensionTotalContribLabel')}`
            : escapeHtml(a.name);
        return `<tr><td>${label}</td><td>${formatCurrency(s?.conservative || 0)}</td><td>${formatCurrency(s?.moderate || 0)}</td><td>${formatCurrency(s?.aggressive || 0)}</td></tr>`;
    }).join('');

    panel.innerHTML = `
        <h4 class="rpt-chart-title">${t('retirement.projectionTitle', { date: escapeHtml(app.retirementTargetDate) })}</h4>
        <p class="rpt-chart-sub">${t('retirement.projectionSub')}</p>
        <div class="acct-balances">${rows.join('')}</div>
        <div class="acct-balance-item"><span class="acct-balance-label">${t('retirement.combinedTotal')}</span><span class="acct-balance-value">${formatCurrency(total)}</span></div>

        <div class="retire-scenario-controls">
            <label for="retireConservativeDeltaInput">${t('retirement.scenarioConservativeDeltaLabel')}</label>
            <input type="number" id="retireConservativeDeltaInput" step="0.5" min="${CONSERVATIVE_DELTA_MIN}" max="${CONSERVATIVE_DELTA_MAX}" value="${conservativeDelta}">
            <label for="retireAggressiveDeltaInput">${t('retirement.scenarioAggressiveDeltaLabel')}</label>
            <input type="number" id="retireAggressiveDeltaInput" step="0.5" min="${AGGRESSIVE_DELTA_MIN}" max="${AGGRESSIVE_DELTA_MAX}" value="${aggressiveDelta}">
        </div>
        <div class="table-wrapper">
            <table class="retire-scenario-table">
                <thead><tr><th scope="col">${t('retirement.a11yAccountCol')}</th><th scope="col">${t('retirement.scenarioConservative')}</th><th scope="col">${t('retirement.scenarioModerate')}</th><th scope="col">${t('retirement.scenarioAggressive')}</th></tr></thead>
                <tbody>
                    ${scenarioRows}
                    <tr class="retire-scenario-total-row"><td>${t('retirement.scenarioCombinedTotalRow')}</td><td>${formatCurrency(scenarioTotal.conservative)}</td><td>${formatCurrency(scenarioTotal.moderate)}</td><td>${formatCurrency(scenarioTotal.aggressive)}</td></tr>
                </tbody>
            </table>
        </div>

        <div class="retire-withdrawal-row">
            <label for="retireWithdrawalRateSlider">${t('retirement.withdrawalRateLabel')}: <strong id="retireWithdrawalRateVal">${withdrawalRate}%</strong></label>
            <span class="help-icon" tabindex="0" aria-label="${t('retirement.withdrawalRateHelp')}">?</span>
            <input type="range" id="retireWithdrawalRateSlider" min="2" max="8" step="0.5" value="${withdrawalRate}" aria-label="${t('retirement.withdrawalRateLabel')}">
        </div>
        <div class="acct-balances">
            <div class="acct-balance-item"><span class="acct-balance-label">${t('retirement.monthlyIncomeConservativeLabel')}</span><span class="acct-balance-value" id="retireMonthlyWithdrawalConservativeVal">${formatCurrency(computeMonthlyWithdrawal(scenarioTotal.conservative, withdrawalRate))}</span></div>
            <div class="acct-balance-item"><span class="acct-balance-label">${t('retirement.monthlyIncomeLabel')}</span><span class="acct-balance-value" id="retireMonthlyWithdrawalVal">${formatCurrency(computeMonthlyWithdrawal(total, withdrawalRate))}</span></div>
            <div class="acct-balance-item"><span class="acct-balance-label">${t('retirement.monthlyIncomeAggressiveLabel')}</span><span class="acct-balance-value" id="retireMonthlyWithdrawalAggressiveVal">${formatCurrency(computeMonthlyWithdrawal(scenarioTotal.aggressive, withdrawalRate))}</span></div>
        </div>
    `;

    const slider = document.getElementById('retireWithdrawalRateSlider');
    const rateValEl = document.getElementById('retireWithdrawalRateVal');
    const monthlyValEl = document.getElementById('retireMonthlyWithdrawalVal');
    const monthlyConservativeValEl = document.getElementById('retireMonthlyWithdrawalConservativeVal');
    const monthlyAggressiveValEl = document.getElementById('retireMonthlyWithdrawalAggressiveVal');
    slider.oninput = () => {
        const rate = Number(slider.value);
        rateValEl.textContent = `${rate}%`;
        monthlyValEl.textContent = formatCurrency(computeMonthlyWithdrawal(total, rate));
        monthlyConservativeValEl.textContent = formatCurrency(computeMonthlyWithdrawal(scenarioTotal.conservative, rate));
        monthlyAggressiveValEl.textContent = formatCurrency(computeMonthlyWithdrawal(scenarioTotal.aggressive, rate));
    };
    slider.onchange = () => {
        setSetting(app, RETIREMENT_WITHDRAWAL_RATE, Number(slider.value));
    };

    document.getElementById('retireConservativeDeltaInput').onchange = (event) => {
        setSetting(app, RETIREMENT_SCENARIO_CONSERVATIVE_DELTA, clampConservativeDelta(event.target.value));
        app.renderRetirementPage();
    };
    document.getElementById('retireAggressiveDeltaInput').onchange = (event) => {
        setSetting(app, RETIREMENT_SCENARIO_AGGRESSIVE_DELTA, clampAggressiveDelta(event.target.value));
        app.renderRetirementPage();
    };
}

export function renderRetirementPage(app) {
    const container = document.getElementById('retirementSection');
    if (!container) return;

    const accounts = getRetirementAccounts(app);

    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="page-header-row"><h2>🏛️ ${t('retirement.pageTitle')}</h2></div>
            <p class="retire-empty-msg">${t('retirement.emptyMsgBefore')} <button class="btn-link" data-retire-action="goto-accounts">${t('retirement.accountsPageBtn')}</button> ${t('retirement.emptyMsgAfter')}</p>`;
        container.onclick = (event) => {
            if (event.target.closest('[data-retire-action="goto-accounts"]')) app.switchPage('accounts');
        };
        return;
    }

    container.innerHTML = `
        <div class="page-header-row"><h2>🏛️ ${t('retirement.pageTitle')}</h2></div>
        <div class="retire-target-date-row form-group">
            <label for="retirementTargetDateInput">${t('retirement.targetDateLabel')}</label>
            <input type="date" id="retirementTargetDateInput" value="${escapeHtml(app.retirementTargetDate || '')}">
        </div>
        <div class="retire-cards">${accounts.map(a => renderAccountCard(app, a)).join('')}</div>
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">${t('retirement.balanceChartTitle')}</h4>
                <p class="rpt-chart-sub">${t('retirement.balanceChartSub')}</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBalanceChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">${t('retirement.contribChartTitle')}</h4>
                <p class="rpt-chart-sub">${t('retirement.contribChartSub')}</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireContributionChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">${t('retirement.breakdownChartTitle')}</h4>
                <p class="rpt-chart-sub">${t('retirement.breakdownChartSub')}</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBreakdownChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">${t('retirement.projectionChartTitle')}</h4>
                <p class="rpt-chart-sub">${t('retirement.projectionChartSub')}</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireProjectionChart"></canvas></div>
            </div>
        </div>
        <div class="retire-card" id="retireProjectionPanel"></div>
    `;

    document.getElementById('retirementTargetDateInput').onchange = (event) => {
        app.retirementTargetDate = event.target.value || null;
        app.saveToStorage();
        app.renderRetirementPage();
    };

    container.onclick = (event) => {
        const actionEl = event.target.closest('[data-retire-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-retire-action');
        if (action === 'add-snapshot') {
            openRetirementSnapshotModal(app, parseInt(actionEl.getAttribute('data-retire-account-id'), 10));
        }
        if (action === 'delete-snapshot') {
            app.deleteRetirementSnapshot(parseInt(actionEl.getAttribute('data-retire-snapshot-id'), 10));
        }
        if (action === 'goto-accounts') {
            app.switchPage('accounts');
        }
    };

    container.onchange = (event) => {
        const actionEl = event.target.closest('[data-retire-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-retire-action');
        const accountId = parseInt(actionEl.getAttribute('data-retire-account-id'), 10);
        const idx = app.accounts.findIndex(a => a.id === accountId);
        if (idx === -1) return;

        if (action === 'toggle-catchup') {
            app.accounts[idx] = { ...app.accounts[idx], catchUpEligible: event.target.checked };
            if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${accountId}`, app.accounts[idx]);
            app.saveToStorage();
            app.renderRetirementPage();
        }
        if (action === 'set-hsa-coverage') {
            const val = event.target.value === 'family' ? 'family' : 'selfOnly';
            app.accounts[idx] = { ...app.accounts[idx], hsaCoverageType: val };
            if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${accountId}`, app.accounts[idx]);
            app.saveToStorage();
            app.renderRetirementPage();
        }
    };

    container.querySelectorAll('[data-progress-width]').forEach(el =>
        el.style.setProperty('--progress-width', el.dataset.progressWidth + '%'));

    renderBalanceChart(app, accounts);
    renderContributionChart(app, accounts);
    renderBreakdownChart(app, accounts);
    const { conservativeDelta, aggressiveDelta } = getScenarioDeltas(app);
    renderProjectionChart(app, accounts, conservativeDelta, aggressiveDelta);
    renderProjectionPanel(app, accounts);
}
