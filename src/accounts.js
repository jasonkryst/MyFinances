// Account management

import { formatCurrency, normalizeText, sanitizeFiniteNumber, escapeHtml, setCollapsibleOpen } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { pgPost, pgPatch, pgDelete } from './postgresSync.js';
import { showAlertModal, showDeleteConfirmModal, showAccountReplacementModal } from './ui.js';
import { recordBalanceHistory, removeHistoryForOwner } from './balanceHistory.js';
import { isHistoryTrackedAccount, HISTORY_TRACKED_ACCOUNT_TYPES } from './balanceHistoryCore.js';
import { getSetting, setSetting, SHOW_ARCHIVED_ACCOUNTS } from './settings.js';
import { t, accountTypeLabel, getIntlLocale } from './i18n.js';

export const ACCOUNT_TYPE_ICONS = { Checking: '🏦', Savings: '💰', Cash: '💵', Investment: '📈', Retirement: '🏛️', 'Credit Card': '💳', Loan: '🏠', Other: '🗂️' };

// Display label for a stored retirement subtype (stored values stay English).
const RETIREMENT_SUBTYPE_KEYS = {
    'Traditional IRA': 'accounts.subtypeTraditionalIra',
    'Pension': 'accounts.subtypePension',
    'Other': 'accounts.subtypeOther'
};
export function retirementSubtypeLabel(subtype) {
    const key = RETIREMENT_SUBTYPE_KEYS[subtype];
    return key ? t(key) : String(subtype ?? '');
}

// "November 2026" in English; other locales get their own long month name
// (without the locale's 'de'-style joiner, which the pseudo-locale guard would flag).
function monthYearLabel(date) {
    return `${date.toLocaleDateString(getIntlLocale(), { month: 'long' })} ${date.getFullYear()}`;
}

export function updateAccountFormRetirementVisibility() {
    const typeEl = document.getElementById('accountType');
    const subtypeEl = document.getElementById('accountRetirementSubtype');
    const isRetirement = typeEl?.value === 'Retirement';
    const isPension = isRetirement && subtypeEl?.value === 'Pension';

    document.getElementById('accountRetirementFieldsGroup')?.classList.toggle('hidden', !isRetirement);
    for (const id of ['accountRateOfReturnGroup', 'accountEmployerMatchGroup']) {
        document.getElementById(id)?.classList.toggle('hidden', !isRetirement || isPension);
    }
    for (const id of ['accountPensionSalaryGroup', 'accountPensionContributionRateGroup', 'accountPensionVestingYearsGroup', 'accountPensionMonthlyBenefitGroup', 'accountPensionYearsOfServiceGroup']) {
        document.getElementById(id)?.classList.toggle('hidden', !isPension);
    }
    document.getElementById('accountMinimumPaymentGroup')?.classList.toggle('hidden', !HISTORY_TRACKED_ACCOUNT_TYPES.includes(typeEl?.value));
}

export function refreshAccountSelectors(app) {
    const selIds = ['incomeAccount','bonusAccount','billAccount','expenseAccount','debtAccount'];
    // opts must already be fully escaped HTML before reaching el.innerHTML below —
    // account name/type are wrapped in escapeHtml() here, not at the assignment site.
    const opts = [
        `<option value="">${escapeHtml(t('accounts.noAccount'))}</option>`,
        ...app.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(accountTypeLabel(a.type))})</option>`)
    ].join('');
    for (const id of selIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const prev = el.value;
        el.innerHTML = opts;
        if (app.accounts.find(a => String(a.id) === prev)) el.value = prev;
    }
}

export function buildAccountOptionsHtml(accounts, selectedId, { emptyLabel } = {}) {
    const empty = emptyLabel ? `<option value="">${emptyLabel}</option>` : '';
    const options = (accounts || []).map(a =>
        `<option value="${a.id}"${selectedId === a.id ? ' selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(accountTypeLabel(a.type))})</option>`
    ).join('');
    return empty + options;
}

export function computeAccountBalance(app, accountId, year = null, month = null) {
    const acct = app.accounts.find(a => a.id === accountId);
    if (!acct) return 0;
    let balance = Number(acct.startingBalance) || 0;

    const now = new Date();
    const yr = year !== null ? year : now.getFullYear();
    const mo = month !== null ? month : now.getMonth();
    const monthTxs = getLedgerTransactionsForMonth(app, yr, mo, accountId);

    for (const tx of monthTxs) {
        balance += Number(tx.amount) || 0;
    }

    return balance;
}

// #257: transaction-level drill-down backing an account's "Proj. (month)"
// figure — reuses the exact same getLedgerTransactionsForMonth() list that
// computeAccountBalance() sums, so the running balance in the modal always
// reconciles with the card's displayed total.
const BREAKDOWN_TYPE_ICONS = { income: '💵', bonus: '🎁', debt: '💳', bill: '🧾', recurring: '🔄', expense: '💸', savings: '💰', transfer: '⇄' };

export function renderAccountBalanceBreakdown(app, accountId, triggerEl = null) {
    const modal = document.getElementById('acctBreakdownModal');
    const content = document.getElementById('acctBreakdownContent');
    if (!modal || !content) return;
    const acct = app.accounts.find(a => a.id === accountId);
    if (!acct) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthLabel = monthYearLabel(now);
    const txs = getLedgerTransactionsForMonth(app, year, month, accountId);

    let running = Number(acct.startingBalance) || 0;
    const rows = txs.map(tx => {
        running += Number(tx.amount) || 0;
        const d = new Date(tx.date);
        const dateStr = d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' });
        const icon = BREAKDOWN_TYPE_ICONS[tx.type] || '•';
        const isNeg = tx.amount < 0;
        const amtCls = isNeg ? 'acct-breakdown-amt--neg' : 'acct-breakdown-amt--pos';
        const sign = isNeg ? '–' : '+';
        return `<div class="acct-breakdown-row">
            <span class="acct-breakdown-date">${dateStr}</span>
            <span class="acct-breakdown-icon" aria-hidden="true">${icon}</span>
            <span class="acct-breakdown-name">${escapeHtml(tx.name)}</span>
            <span class="acct-breakdown-amt ${amtCls}">${sign}${formatCurrency(Math.abs(tx.amount))}</span>
            <span class="acct-breakdown-running">${formatCurrency(running)}</span>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="spending-modal-header">
            <div>
                <h3 class="spending-modal-title" id="acctBreakdownTitle">${escapeHtml(acct.name)} — ${escapeHtml(monthLabel)}</h3>
                <p class="spending-modal-subtitle">${escapeHtml(txs.length === 1
                    ? t('accounts.breakdownSubtitleOne', { amount: formatCurrency(acct.startingBalance) })
                    : t('accounts.breakdownSubtitleMany', { count: txs.length, amount: formatCurrency(acct.startingBalance) }))}</p>
            </div>
        </div>
        ${txs.length > 0 ? `<div class="acct-breakdown-header-row">
            <span>${t('accounts.breakdownColDate')}</span><span></span><span>${t('accounts.breakdownColDescription')}</span><span>${t('accounts.breakdownColAmount')}</span><span>${t('accounts.breakdownColBalance')}</span>
        </div>` : ''}
        <div class="acct-breakdown-list">${rows || `<p class="spending-empty-detail">${t('accounts.breakdownEmpty')}</p>`}</div>
        <div class="spending-modal-footer">
            <button class="btn btn-secondary" id="acctBreakdownViewLedgerBtn" aria-label="${escapeHtml(t('accounts.viewInLedgerAria', { name: acct.name }))}">${t('accounts.viewInLedger')}</button>
            <button class="btn btn-secondary" id="acctBreakdownClose" aria-label="${t('accounts.closeBreakdownAria')}">${t('common.close')}</button>
        </div>`;
    modal.classList.remove('hidden');

    const close = () => {
        modal.classList.add('hidden');
        modal.removeEventListener('keydown', handleKeydown);
        modal.onclick = null;
        if (triggerEl) triggerEl.focus();
    };

    const handleKeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Tab') {
            const focusable = Array.from(modal.querySelectorAll(
                'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ));
            if (focusable.length === 0) { e.preventDefault(); return; }
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    };

    document.getElementById('acctBreakdownClose').onclick = close;
    document.getElementById('acctBreakdownViewLedgerBtn').onclick = () => {
        close();
        // Pre-filters Ledger to this account; dateRange is left at 'all'
        // rather than scoped to the current month, since Ledger has no
        // exact-calendar-month filter (its date options are all relative —
        // around today, next N days, etc.) — see #257 discussion.
        app._ledgerAccountFilter = accountId;
        app._ledgerCategoryFilter = 'all';
        app._ledgerDateRange = 'all';
        app._ledgerPage = 1;
        app._ledgerFiltersRestored = true;
        app.switchPage('ledger');
    };
    modal.onclick = e => { if (e.target === modal) close(); };
    modal.addEventListener('keydown', handleKeydown);
    modal.focus();
}

export function renderAccountsList(app) {
    const container = document.getElementById('accountList');
    if (!container) return;

    if (!app.accounts || app.accounts.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">🏦</div>
            <h3 class="empty-state__heading">${t('accounts.emptyHeading')}</h3>
            <p class="empty-state__body">${t('accounts.emptyBody')}</p>
            <button class="btn btn-primary empty-state__cta" id="acctEmptyStateCta">${t('accounts.emptyCta')}</button>
        </div>`;
        document.getElementById('acctEmptyStateCta')?.addEventListener('click', () => {
            setCollapsibleOpen('accountFormBody', true);
            document.getElementById('accountForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => document.getElementById('accountName')?.focus(), 300);
        });
        return;
    }

    const ACCT_TYPES = ['Checking','Savings','Cash','Investment','Retirement','Credit Card','Loan','Other'];
    const typeIcon = ACCOUNT_TYPE_ICONS;

    const now = new Date();
    const monthLabel = monthYearLabel(now);

    const showArchived = getSetting(app, SHOW_ARCHIVED_ACCOUNTS, false);
    const activeAccounts = showArchived ? app.accounts : app.accounts.filter(a => !a.archived);
    const archivedCount = app.accounts.filter(a => a.archived).length;

    // Apply type filter
    const typeFilter = document.getElementById('accountTypeFilter')?.value || '';
    let displayAccounts = typeFilter
        ? activeAccounts.filter(a => a.type === typeFilter)
        : activeAccounts.slice();

    // Apply sort
    const sortBy = document.getElementById('accountSortBy')?.value || '';
    if (sortBy) {
        displayAccounts = [...displayAccounts].sort((a, b) => {
            if (sortBy === 'name-asc') return (a.name || '').localeCompare(b.name || '');
            if (sortBy === 'name-desc') return (b.name || '').localeCompare(a.name || '');
            if (sortBy === 'type-asc') return (a.type || '').localeCompare(b.type || '');
            if (sortBy === 'balance-desc' || sortBy === 'balance-asc') {
                const va = app.computeAccountBalance(a.id);
                const vb = app.computeAccountBalance(b.id);
                return sortBy === 'balance-desc' ? vb - va : va - vb;
            }
            if (sortBy === 'apy-desc') return (b.interestRate || 0) - (a.interestRate || 0);
            if (sortBy === 'apy-asc') return (a.interestRate || 0) - (b.interestRate || 0);
            return 0;
        });
    }

    const cards = displayAccounts.map(a => {
        if (app.editingAccountId === a.id) {
            return `<div class="acct-card acct-card--editing">
                <div class="acct-edit-grid">
                    <div class="form-group form-no-margin">
                        <label class="label-compact">${t('accounts.editName')}</label>
                        <input type="text" id="ac-name-${a.id}" value="${escapeHtml(a.name)}" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">${t('accounts.editType')}</label>
                        <select id="ac-type-${a.id}" class="form-full-width">
                            ${ACCT_TYPES.map(ty => `<option value="${ty}" ${a.type===ty?'selected':''}>${escapeHtml(accountTypeLabel(ty))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">${t('accounts.editStartingBalance')}</label>
                        <input type="number" id="ac-bal-${a.id}" value="${a.startingBalance}" step="0.01" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin">
                        <label class="label-compact">${t('accounts.interestRateLabel')}</label>
                        <input type="number" id="ac-rate-${a.id}" value="${Number(a.interestRate) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${isHistoryTrackedAccount(a) ? '' : 'hidden'}" id="ac-minpay-group-${a.id}">
                        <label class="label-compact">${t('accounts.minPaymentLabel')}</label>
                        <input type="number" id="ac-minpay-${a.id}" value="${Number(a.minimumPayment) || 0}" step="0.01" min="0" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.subtypeLabel')}</label>
                        <select id="ac-retiresub-${a.id}" class="form-full-width">
                            ${['401k','Traditional IRA','Roth IRA','HSA','Pension','Other'].map(s => `<option value="${s}" ${a.retirementSubtype===s?'selected':''}>${escapeHtml(retirementSubtypeLabel(s))}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype === 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.editRateOfReturn')}</label>
                        <input type="number" id="ac-ror-${a.id}" value="${Number(a.rateOfReturn) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype === 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.employerMatchLabel')}</label>
                        <input type="number" id="ac-match-${a.id}" value="${Number(a.employerMatchPercent) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype !== 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.pensionSalaryLabel')}</label>
                        <input type="number" id="ac-pension-salary-${a.id}" value="${Number(a.pensionAnnualSalary) || 0}" step="0.01" min="0" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype !== 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.pensionContributionRateLabel')}</label>
                        <input type="number" id="ac-pension-rate-${a.id}" value="${Number(a.pensionContributionRatePct) || 0}" step="0.01" min="0" max="100" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype !== 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.vestingYearsLabel')}</label>
                        <input type="number" id="ac-pension-vesting-${a.id}" value="${Number(a.pensionVestingYears) || 0}" step="1" min="0" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype !== 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.monthlyBenefitLabel')}</label>
                        <input type="number" id="ac-pension-benefit-${a.id}" value="${Number(a.pensionEstimatedMonthlyBenefit) || 0}" step="0.01" min="0" class="form-full-width">
                    </div>
                    <div class="form-group form-no-margin ${a.type !== 'Retirement' || a.retirementSubtype !== 'Pension' ? 'hidden' : ''}">
                        <label class="label-compact">${t('accounts.yearsOfServiceLabel')}</label>
                        <input type="number" id="ac-pension-service-${a.id}" value="${Number(a.pensionYearsOfService) || 0}" step="1" min="0" class="form-full-width">
                    </div>
                </div>
                <div class="acct-edit-actions">
                    <button class="btn btn-primary btn-small" data-account-action="save" data-account-id="${a.id}" aria-label="${escapeHtml(t('entity.saveChangesAria', { name: a.name }))}">${t('common.save')}</button>
                    <button class="btn btn-secondary btn-small" data-account-action="cancel" aria-label="${escapeHtml(t('entity.cancelEditAria', { name: a.name }))}">${t('common.cancel')}</button>
                </div>
            </div>`;
        }

        const projBalance = app.computeAccountBalance(a.id);
        const balClass = projBalance >= 0 ? 'acct-balance--pos' : 'acct-balance--neg';

        // Items linked to this account — shown as grouped count chips, not per-item pills
        const linkedIncomeCount   = app.incomes.filter(i => i.accountId === a.id).length
                                  + app.bonuses.filter(b => b.accountId === a.id).length;
        const linkedDebtCount     = app.debts.filter(d => d.accountId === a.id).length;
        const linkedBillCount     = app.bills.filter(b => b.accountId === a.id).length;
        const linkedExpCount      = app.expenses.filter(e => e.accountId === a.id).length;
        const linkedRecurringCount = (app.recurringTemplates || []).filter(r => r.accountId === a.id || r.targetAccountId === a.id).length;
        const typeGroups = [
            { label: t('nav.income'),         count: linkedIncomeCount,    page: 'income',      cls: 'acct-link--income'    },
            { label: t('accounts.linkDebts'), count: linkedDebtCount,      page: 'liabilities', cls: 'acct-link--debt'      },
            { label: t('accounts.linkBudget'), count: linkedBillCount + linkedExpCount, page: 'liabilities', cls: 'acct-link--bill' },
            { label: t('nav.recurring'),      count: linkedRecurringCount, page: 'recurring',   cls: 'acct-link--recurring' },
        ].filter(g => g.count > 0);

        const linkRows = typeGroups.length === 0 ? '' : `
            <div class="acct-links">
                ${typeGroups.map(g => `<button class="acct-link ${escapeHtml(g.cls)} acct-link--nav" data-account-nav-page="${escapeHtml(g.page)}" title="${escapeHtml(t('accounts.goTo', { label: g.label }))}" aria-label="${escapeHtml(t('accounts.goToLinkedAria', { label: g.label, name: a.name }))}">${escapeHtml(g.label)} (${g.count})</button>`).join('')}
            </div>`;

        return `<div class="acct-card${a.archived ? ' acct-card--archived' : ''}">
            <div class="acct-card-header">
                <span class="acct-type-icon">${typeIcon[a.type] || '🗂️'}</span>
                <div class="acct-card-info">
                    <span class="acct-card-name">${escapeHtml(a.name)} (${escapeHtml(accountTypeLabel(a.type))})</span>
                    ${a.archived ? `<span class="acct-archived-badge">${t('accounts.archivedBadge')}</span>` : ''}
                    ${Number(a.interestRate) >= 0.01 ? `<span class="acct-rate-badge">📈 ${escapeHtml(t('accounts.apyBadge', { rate: Number(a.interestRate).toFixed(2) }))}</span>` : ''}
                    ${a.type === 'Retirement' && a.retirementSubtype === 'Pension' ? `<span class="acct-rate-badge">🏛️ ${escapeHtml(t('accounts.pensionBadge', { salary: formatCurrency(Number(a.pensionAnnualSalary)), rate: Number(a.pensionContributionRatePct).toFixed(1) }))}</span>` : ''}
                    ${a.type === 'Retirement' && a.retirementSubtype !== 'Pension' ? `<span class="acct-rate-badge">🏛️ ${escapeHtml(t('accounts.retirementBadge', { subtype: retirementSubtypeLabel(a.retirementSubtype), rate: Number(a.rateOfReturn).toFixed(1) }))}</span>` : ''}
                </div>
                <div class="acct-balances">
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">${t('accounts.balanceStarting')}</span>
                        <span class="acct-balance-value">${formatCurrency(a.startingBalance)}</span>
                    </div>
                    <div class="acct-balance-item">
                        <span class="acct-balance-label">${escapeHtml(t('accounts.balanceProjected', { month: monthLabel }))}</span>
                        <span class="acct-balance-value ${balClass}">${formatCurrency(projBalance)}</span>
                        <button type="button" class="acct-balance-breakdown-btn" data-account-action="breakdown" data-account-id="${a.id}" aria-label="${escapeHtml(t('accounts.seeBreakdownAria', { name: a.name }))}">${t('accounts.seeBreakdown')}</button>
                    </div>
                </div>
                <div class="debt-actions acct-card-actions">
                    ${isHistoryTrackedAccount(a) ? `<button class="btn btn-secondary btn-small" data-account-action="history" data-account-id="${a.id}" aria-label="${escapeHtml(t('accounts.historyAria', { name: a.name }))}">${t('accounts.historyBtn')}</button>` : ''}
                    ${a.type === 'Retirement' ? '' : `<button class="btn btn-secondary btn-small" data-account-action="transfer" data-account-id="${a.id}" aria-label="${escapeHtml(t('accounts.transferAria', { name: a.name }))}">⇄ ${t('accounts.transferBtn')}</button>`}
                    <button class="btn btn-secondary btn-small" data-account-action="edit" data-account-id="${a.id}" aria-label="${escapeHtml(t('entity.editAria', { name: a.name }))}">${t('common.edit')}</button>
                    <button class="btn btn-secondary btn-small" data-account-action="${a.archived ? 'unarchive' : 'archive'}" data-account-id="${a.id}" title="${a.archived ? t('accounts.unarchiveTitle') : t('accounts.archiveTitle')}" aria-label="${escapeHtml(t(a.archived ? 'accounts.unarchiveAria' : 'accounts.archiveAria', { name: a.name }))}">${a.archived ? t('accounts.unarchive') : t('accounts.archive')}</button>
                    <button class="btn btn-danger btn-small" data-account-action="delete" data-account-id="${a.id}" aria-label="${escapeHtml(t('entity.deleteAria', { name: a.name }))}">${t('common.delete')}</button>
                </div>
            </div>
            ${linkRows}
        </div>`;
    }).join('');

    const archivedToggle = archivedCount > 0
        ? `<div class="acct-archived-toggle">
               <button class="btn btn-secondary btn-small" id="acctToggleArchived" aria-pressed="${showArchived ? 'true' : 'false'}">
                   ${showArchived ? t('accounts.hideArchived') : t('accounts.showArchived', { count: archivedCount })}
               </button>
           </div>`
        : '';
    if (displayAccounts.length === 0) {
        const filterMsg = typeFilter
            ? t('accounts.noneOfType', { type: escapeHtml(accountTypeLabel(typeFilter)) })
            : `${t('accounts.noActive')} ${archivedCount > 0 ? t('accounts.toggleArchivedHint') : ''}`;
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">🔍</div>
            <h3 class="empty-state__heading">${t('accounts.noMatchHeading')}</h3>
            <p class="empty-state__body">${filterMsg}</p>
        </div>${archivedToggle}`;
        document.getElementById('acctToggleArchived')?.addEventListener('click', () => {
            setSetting(app, SHOW_ARCHIVED_ACCOUNTS, !showArchived);
            app.renderAccountsList();
        });
        container.onclick = null;
        return;
    }

    container.innerHTML = cards + archivedToggle;

    document.getElementById('acctToggleArchived')?.addEventListener('click', () => {
        setSetting(app, SHOW_ARCHIVED_ACCOUNTS, !showArchived);
        app.renderAccountsList();
    });

    container.onclick = (event) => {
        const navChip = event.target.closest('[data-account-nav-page]');
        if (navChip) {
            app.switchPage(navChip.getAttribute('data-account-nav-page'));
            return;
        }
        const actionEl = event.target.closest('[data-account-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-account-action');
        const id = parseInt(actionEl.getAttribute('data-account-id'), 10);
        if (action === 'cancel') {
            app.cancelEditAccount();
            return;
        }
        if (Number.isNaN(id)) return;
        if (action === 'save') app.saveEditAccount(id);
        if (action === 'edit') app.startEditAccount(id);
        if (action === 'delete') app.deleteAccount(id);
        if (action === 'archive') app.archiveAccount(id);
        if (action === 'unarchive') app.unarchiveAccount(id);
        if (action === 'history') app.showBalanceHistoryModal({ kind: 'account', id });
        if (action === 'breakdown') app.showAccountBalanceBreakdown(id, actionEl);
        if (action === 'transfer' && typeof app.openTransferModal === 'function') app.openTransferModal({ fromAccountId: id });
    };
    container.onchange = (event) => {
        const typeSelect = event.target.closest('select[id^="ac-type-"]');
        if (!typeSelect) return;
        const id = typeSelect.id.slice('ac-type-'.length);
        document.getElementById(`ac-minpay-group-${id}`)?.classList.toggle('hidden', !HISTORY_TRACKED_ACCOUNT_TYPES.includes(typeSelect.value));
    };
}

export async function addAccount(app) {
    const name = normalizeText(document.getElementById('accountName').value, 80);
    const type = normalizeText(document.getElementById('accountType').value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById('accountStartingBalance').value, NaN);
    const interestRate = sanitizeFiniteNumber(document.getElementById('accountInterestRate')?.value, 0, { min: 0, max: 100 });
    const retirementSubtype = normalizeText(document.getElementById('accountRetirementSubtype')?.value, 30) || 'Other';
    const rateOfReturn = sanitizeFiniteNumber(document.getElementById('accountRateOfReturn')?.value, 0, { min: 0, max: 100 });
    const employerMatchPercent = sanitizeFiniteNumber(document.getElementById('accountEmployerMatch')?.value, 0, { min: 0, max: 100 });
    const pensionAnnualSalary = sanitizeFiniteNumber(document.getElementById('accountPensionSalary')?.value, 0, { min: 0 });
    const pensionContributionRatePct = sanitizeFiniteNumber(document.getElementById('accountPensionContributionRate')?.value, 0, { min: 0, max: 100 });
    const pensionVestingYears = sanitizeFiniteNumber(document.getElementById('accountPensionVestingYears')?.value, 0, { min: 0 });
    const pensionEstimatedMonthlyBenefit = sanitizeFiniteNumber(document.getElementById('accountPensionMonthlyBenefit')?.value, 0, { min: 0 });
    const pensionYearsOfService = sanitizeFiniteNumber(document.getElementById('accountPensionYearsOfService')?.value, 0, { min: 0 });
    const minimumPayment = sanitizeFiniteNumber(document.getElementById('accountMinimumPayment')?.value, 0, { min: 0 });

    if (!name) { await showAlertModal(t('accounts.errName')); return; }
    if (isNaN(startingBalance)) { await showAlertModal(t('accounts.errStartingBalance')); return; }

    const account = { id: Date.now(), name, type, startingBalance, interestRate, retirementSubtype, rateOfReturn, employerMatchPercent, pensionAnnualSalary, pensionContributionRatePct, pensionVestingYears, pensionEstimatedMonthlyBenefit, pensionYearsOfService, minimumPayment };
    app.accounts.push(account);
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') {
        const saved = await pgPost(app, '/api/accounts', account);
        if (saved?.id) account.id = saved.id;
    }
    await recordBalanceHistory(app, { kind: 'account', id: account.id });
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
    document.getElementById('accountForm').reset();
    updateAccountFormRetirementVisibility();
}

export async function deleteAccount(app, id) {
    const account = app.accounts.find(a => a.id === id);
    if (!account) return;

    const linkedIncome    = app.incomes.filter(i => i.accountId === id);
    const linkedBonuses   = (app.bonuses || []).filter(b => b.accountId === id);
    const linkedDebts     = app.debts.filter(d => d.accountId === id);
    const linkedBills     = app.bills.filter(b => b.accountId === id);
    const linkedExp       = app.expenses.filter(e => e.accountId === id);
    const linkedRecurring = (app.recurringTemplates || []).filter(r => r.accountId === id || r.targetAccountId === id);
    const hasLinks = linkedIncome.length || linkedBonuses.length || linkedDebts.length ||
                     linkedBills.length || linkedExp.length || linkedRecurring.length;

    if (hasLinks) {
        const replacementId = await showAccountReplacementModal(app, id);
        if (replacementId === null) return;

        const replacement = app.accounts.find(a => a.id === replacementId);
        const totalLinked = linkedIncome.length + linkedBonuses.length + linkedDebts.length +
                            linkedBills.length + linkedExp.length + linkedRecurring.length;
        const confirmed = await showDeleteConfirmModal(
            t('accounts.confirmReassign', { name: account.name, count: totalLinked, replacement: replacement?.name ?? '' }),
            t('accounts.deleteAndReassign')
        );
        if (!confirmed) return;

        _reassignLinkedItems(app, id, replacementId);
    } else {
        const confirmed = await showDeleteConfirmModal(t('accounts.confirmDelete', { name: account.name }));
        if (!confirmed) return;
    }

    app.accounts = app.accounts.filter(a => a.id !== id);
    removeHistoryForOwner(app, { kind: 'account', id });
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgDelete(app, `/api/accounts/${id}`);
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
}

export function archiveAccount(app, id) {
    const idx = app.accounts.findIndex(a => a.id === id);
    if (idx === -1) return;
    app.accounts[idx] = { ...app.accounts[idx], archived: true };
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${id}`, { archived: true });
    app.renderAccountsList();
    app.renderNetWorthWidget();
}

export function unarchiveAccount(app, id) {
    const idx = app.accounts.findIndex(a => a.id === id);
    if (idx === -1) return;
    app.accounts[idx] = { ...app.accounts[idx], archived: false };
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${id}`, { archived: false });
    app.renderAccountsList();
    app.renderNetWorthWidget();
}

function _reassignLinkedItems(app, fromId, toId) {
    for (const item of app.incomes)   { if (item.accountId === fromId) item.accountId = toId; }
    for (const item of (app.bonuses || [])) { if (item.accountId === fromId) item.accountId = toId; }
    for (const item of app.debts)     { if (item.accountId === fromId) item.accountId = toId; }
    for (const item of app.bills)     { if (item.accountId === fromId) item.accountId = toId; }
    for (const item of app.expenses)  { if (item.accountId === fromId) item.accountId = toId; }
    for (const item of (app.recurringTemplates || [])) {
        if (item.accountId === fromId) item.accountId = toId;
        if (item.targetAccountId === fromId) item.targetAccountId = toId;
    }
}

export function startEditAccount(app, id) {
    app.editingAccountId = id;
    app.renderAccountsList();
    setTimeout(() => { const el = document.getElementById(`ac-name-${id}`); if (el) el.focus(); }, 0);
}

export function cancelEditAccount(app) {
    app.editingAccountId = null;
    app.renderAccountsList();
}

export async function saveEditAccount(app, id) {
    const idx = app.accounts.findIndex(a => a.id === id);
    if (idx === -1) return;
    const name = normalizeText(document.getElementById(`ac-name-${id}`)?.value, 80);
    const type = normalizeText(document.getElementById(`ac-type-${id}`)?.value, 30);
    const startingBalance = sanitizeFiniteNumber(document.getElementById(`ac-bal-${id}`)?.value, NaN);
    const interestRate = sanitizeFiniteNumber(document.getElementById(`ac-rate-${id}`)?.value, 0, { min: 0, max: 100 });
    const retirementSubtype = normalizeText(document.getElementById(`ac-retiresub-${id}`)?.value, 30) || 'Other';
    const rateOfReturn = sanitizeFiniteNumber(document.getElementById(`ac-ror-${id}`)?.value, 0, { min: 0, max: 100 });
    const employerMatchPercent = sanitizeFiniteNumber(document.getElementById(`ac-match-${id}`)?.value, 0, { min: 0, max: 100 });
    const pensionAnnualSalary = sanitizeFiniteNumber(document.getElementById(`ac-pension-salary-${id}`)?.value, 0, { min: 0 });
    const pensionContributionRatePct = sanitizeFiniteNumber(document.getElementById(`ac-pension-rate-${id}`)?.value, 0, { min: 0, max: 100 });
    const pensionVestingYears = sanitizeFiniteNumber(document.getElementById(`ac-pension-vesting-${id}`)?.value, 0, { min: 0 });
    const pensionEstimatedMonthlyBenefit = sanitizeFiniteNumber(document.getElementById(`ac-pension-benefit-${id}`)?.value, 0, { min: 0 });
    const pensionYearsOfService = sanitizeFiniteNumber(document.getElementById(`ac-pension-service-${id}`)?.value, 0, { min: 0 });
    const minimumPayment = sanitizeFiniteNumber(document.getElementById(`ac-minpay-${id}`)?.value, 0, { min: 0 });
    if (!name) { await showAlertModal(t('accounts.errName')); return; }
    if (isNaN(startingBalance)) { await showAlertModal(t('accounts.errValidStartingBalance')); return; }
    app.accounts[idx] = { ...app.accounts[idx], name, type, startingBalance, interestRate, retirementSubtype, rateOfReturn, employerMatchPercent, pensionAnnualSalary, pensionContributionRatePct, pensionVestingYears, pensionEstimatedMonthlyBenefit, pensionYearsOfService, minimumPayment };
    app.editingAccountId = null;
    app.saveToStorage();
    if (app._storageBackendKind === 'postgres') pgPatch(app, `/api/accounts/${app.accounts[idx].id}`, app.accounts[idx]);
    await recordBalanceHistory(app, { kind: 'account', id: app.accounts[idx].id });
    app.renderAccountsList();
    app.renderNetWorthWidget();
    refreshAccountSelectors(app);
}
