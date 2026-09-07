// Retirement accounts: history log, projection, and page rendering.

import { computeRetirementProjection, splitGrowthFromContribution } from './retirementCalculator.js';
import { pgPost, pgDelete } from './postgresSync.js';
import { formatCurrency, escapeHtml, todayISO, renderChartDataTable } from './utils.js';

export function getRetirementAccounts(app) {
    return (app.accounts || []).filter(a => a.type === 'Retirement');
}

export function getSnapshotsForAccount(app, accountId) {
    return (app.retirementSnapshots || [])
        .filter(s => s.accountId === accountId)
        .sort((a, b) => a.date.localeCompare(b.date));
}

export async function addRetirementSnapshot(app, accountId, date, balance, contribution) {
    const snapshot = { id: Date.now(), accountId, date, balance, contribution };
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

// Projects an account's value at app.retirementTargetDate, assuming the
// account's rateOfReturn compounds monthly and its most recently logged
// contribution (boosted by employerMatchPercent) recurs every month until
// then. Returns null if no target date is set or the account doesn't exist.
export function computeAccountProjection(app, accountId) {
    if (!app.retirementTargetDate) return null;
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!account) return null;

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);
    const lastContribution = latest ? latest.contribution : 0;
    const employerMultiplier = 1 + (Number(account.employerMatchPercent) || 0) / 100;
    const monthlyContribution = lastContribution * employerMultiplier;

    const monthsUntilTarget = DebtCalculator.calculateMonthsBetweenDates(
        new Date(),
        new Date(`${app.retirementTargetDate}T12:00:00`)
    );

    return computeRetirementProjection(currentBalance, monthlyContribution, Number(account.rateOfReturn) || 0, monthsUntilTarget);
}

export function openRetirementSnapshotModal(app, accountId) {
    const modal = document.getElementById('retirementSnapshotModal');
    const account = (app.accounts || []).find(a => a.id === accountId);
    if (!modal || !account) return;

    const dateInput = document.getElementById('retirementSnapshotModalDate');
    const balanceInput = document.getElementById('retirementSnapshotModalBalance');
    const contributionInput = document.getElementById('retirementSnapshotModalContribution');
    const confirmBtn = document.getElementById('retirementSnapshotModalConfirmBtn');
    const cancelBtn = document.getElementById('retirementSnapshotModalCancelBtn');
    const closeBtn = document.getElementById('retirementSnapshotModalCloseBtn');
    if (!dateInput || !balanceInput || !contributionInput || !confirmBtn || !cancelBtn || !closeBtn) return;

    const snapshots = getSnapshotsForAccount(app, accountId);
    const latest = snapshots[snapshots.length - 1];
    dateInput.value = todayISO();
    balanceInput.value = latest ? latest.balance : (Number(account.startingBalance) || 0);
    contributionInput.value = latest ? latest.contribution : 0;

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    confirmBtn.onclick = async () => {
        const balance = Number(balanceInput.value);
        const contribution = Number(contributionInput.value) || 0;
        if (!Number.isFinite(balance) || balance < 0) return;
        await app.addRetirementSnapshot(accountId, dateInput.value || todayISO(), balance, contribution);
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

function renderAccountCard(app, account) {
    const snapshots = getSnapshotsForAccount(app, account.id);
    const latest = snapshots[snapshots.length - 1];
    const currentBalance = latest ? latest.balance : (Number(account.startingBalance) || 0);

    const rows = snapshots.length === 0
        ? `<tr><td colspan="4" class="retire-empty-msg">No balances logged yet.</td></tr>`
        : [...snapshots].reverse().map(s => `
            <tr>
                <td>${escapeHtml(s.date)}</td>
                <td>${formatCurrency(s.balance)}</td>
                <td>${formatCurrency(s.contribution)}</td>
                <td><button class="btn btn-danger btn-small" data-retire-action="delete-snapshot" data-retire-snapshot-id="${s.id}">Delete</button></td>
            </tr>`).join('');

    return `
        <div class="retire-card">
            <div class="retire-card-header">
                <span class="acct-type-icon">🏛️</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${escapeHtml(account.name)} (${escapeHtml(account.retirementSubtype)})</span>
                    <span class="acct-rate-badge">📈 ${Number(account.rateOfReturn).toFixed(1)}% est. return${Number(account.employerMatchPercent) > 0 ? ` · ${Number(account.employerMatchPercent).toFixed(0)}% match` : ''}</span>
                </div>
                <div class="retire-stat">
                    <span class="acct-balance-label">Current Balance</span>
                    <span class="acct-balance-value">${formatCurrency(currentBalance)}</span>
                </div>
                <button class="btn btn-primary btn-small" data-retire-action="add-snapshot" data-retire-account-id="${account.id}">+ Add Snapshot</button>
            </div>
            <div class="table-wrapper">
                <table class="retire-snapshot-table">
                    <thead><tr><th>Date</th><th>Balance</th><th>Contribution</th><th></th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
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
        caption: 'Retirement account balances over time',
        columns: ['Date', ...accounts.map(a => a.name)],
        rows: allDates.map((d, i) => [d, ...datasets.map(ds => ds.data[i] != null ? formatCurrency(ds.data[i]) : '—')])
    });
}

function renderContributionChart(app, accounts) {
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
                { label: 'Contribution', data: contributionData, backgroundColor: '#2563eb', stack: 's', borderRadius: 4 },
                { label: 'Growth', data: growthData, backgroundColor: '#10b981', stack: 's', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: label } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}` } } },
            scales: { y: { stacked: true, ticks: { color: label, callback: v => formatCurrency(v) }, grid: { color: grid } }, x: { stacked: true, ticks: { color: label }, grid: { color: grid } } }
        }
    });

    renderChartDataTable('retireContributionChart', {
        caption: 'Contribution vs. growth per period, summed across retirement accounts',
        columns: ['Date', 'Contribution', 'Growth'],
        rows: dates.map((d, i) => [d, formatCurrency(contributionData[i]), formatCurrency(growthData[i])])
    });
}

function renderBreakdownChart(app, accounts) {
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
        caption: 'Current retirement balance by account',
        columns: ['Account', 'Balance'],
        rows: accounts.map((a, i) => [a.name, formatCurrency(balances[i])])
    });
}

function renderProjectionPanel(app, accounts) {
    const panel = document.getElementById('retireProjectionPanel');
    if (!panel) return;

    if (!app.retirementTargetDate) {
        panel.innerHTML = `<p class="retire-empty-msg">Set a target retirement date above to see a projected future value.</p>`;
        return;
    }

    const rows = accounts.map(a => {
        const projected = app.computeAccountProjection(a.id);
        return `<div class="acct-balance-item"><span class="acct-balance-label">${escapeHtml(a.name)}</span><span class="acct-balance-value">${formatCurrency(projected)}</span></div>`;
    });
    const total = accounts.reduce((sum, a) => sum + (app.computeAccountProjection(a.id) || 0), 0);

    panel.innerHTML = `
        <h4 class="rpt-chart-title">Projected Value at ${escapeHtml(app.retirementTargetDate)}</h4>
        <p class="rpt-chart-sub">Assumes each account's rate of return compounds monthly and its most recently logged contribution (plus employer match) recurs every month until then.</p>
        <div class="acct-balances">${rows.join('')}</div>
        <div class="acct-balance-item"><span class="acct-balance-label">Combined Total</span><span class="acct-balance-value">${formatCurrency(total)}</span></div>
    `;
}

export function renderRetirementPage(app) {
    const container = document.getElementById('retirementSection');
    if (!container) return;

    const accounts = getRetirementAccounts(app);

    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="page-header-row"><h2>🏛️ Retirement</h2></div>
            <p class="retire-empty-msg">No retirement accounts yet. Add one from the <button class="btn-link" data-retire-action="goto-accounts">Accounts page</button> (choose type "Retirement") to start tracking it here.</p>`;
        container.onclick = (event) => {
            if (event.target.closest('[data-retire-action="goto-accounts"]')) app.switchPage('accounts');
        };
        return;
    }

    container.innerHTML = `
        <div class="page-header-row"><h2>🏛️ Retirement</h2></div>
        <div class="retire-target-date-row form-group">
            <label for="retirementTargetDateInput">Target Retirement Date</label>
            <input type="date" id="retirementTargetDateInput" value="${app.retirementTargetDate || ''}">
        </div>
        <div class="retire-cards">${accounts.map(a => renderAccountCard(app, a)).join('')}</div>
        <div class="rpt-charts-row">
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Balance Over Time</h4>
                <p class="rpt-chart-sub">Logged balance per retirement account</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBalanceChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Contribution vs. Growth</h4>
                <p class="rpt-chart-sub">Per period, summed across all retirement accounts (growth includes any employer match, since match amounts aren't logged separately)</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireContributionChart"></canvas></div>
            </div>
            <div class="rpt-chart-card">
                <h4 class="rpt-chart-title">Current Balance by Account</h4>
                <p class="rpt-chart-sub">Share of total retirement balance</p>
                <div class="rpt-chart-canvas-wrap"><canvas id="retireBreakdownChart"></canvas></div>
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

    renderBalanceChart(app, accounts);
    renderContributionChart(app, accounts);
    renderBreakdownChart(app, accounts);
    renderProjectionPanel(app, accounts);
}
