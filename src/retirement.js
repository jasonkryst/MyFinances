// Retirement accounts: history log, projection, and page rendering.

import { computeRetirementProjection } from './retirementCalculator.js';
import { pgPost, pgDelete } from './postgresSync.js';
import { formatCurrency, escapeHtml, todayISO } from './utils.js';

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
}
