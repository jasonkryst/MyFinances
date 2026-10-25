﻿﻿// UI helpers, event listeners, theming
import { renderLedgerPage } from './ledger.js';
import { refreshAccountSelectors, updateAccountFormRetirementVisibility } from './accounts.js';
import { refreshPersonSelectors } from './people.js';
import { refreshCategoryDatalist } from './recurring.js';
import { APP_VERSION, escapeHtml } from './utils.js';
import { initCommandPalette } from './commandPalette.js';

const LAST_SEEN_VERSION_KEY = 'debtTrackerLastSeenVersion';

// Order matters for cycleTheme() (commandPalette.js), which steps through
// this list by index.
export const THEMES = ['light', 'dark', 'high-contrast'];

// High Contrast is built on top of Dark Mode (both classes applied together)
// so it inherits dark-mode's existing surface colors and the JS chart/gauge
// color logic that already branches on `dark-mode` (forecast.js, health.js,
// reportsCashFlow.js, reportsNetWorth.js), then layers stronger overrides
// via `body.dark-mode.high-contrast-mode` in styles.css.
export function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'light';
    document.body.classList.toggle('dark-mode', t === 'dark' || t === 'high-contrast');
    document.body.classList.toggle('high-contrast-mode', t === 'high-contrast');
    const themeSwitcher = document.getElementById('themeSwitcher');
    if (themeSwitcher) themeSwitcher.value = t;
    return t;
}

export function initializeEventListeners(app) {
    initCommandPalette(app);
    const themeSwitcher = document.getElementById('themeSwitcher');

    const savedTheme = localStorage.getItem('debtTrackerTheme');
    if (THEMES.includes(savedTheme)) {
        applyTheme(savedTheme);
    }

    if (themeSwitcher) {
        themeSwitcher.addEventListener('change', () => {
            const applied = applyTheme(themeSwitcher.value);
            localStorage.setItem('debtTrackerTheme', applied);
        });
    }

    // Reports → Calendar shortcut button in toolbar
    const reportsCalendarShortcutBtn = document.getElementById('reportsCalendarShortcutBtn');
    if (reportsCalendarShortcutBtn) {
        reportsCalendarShortcutBtn.addEventListener('click', () => navigateToReportsCalendar(app));
    }

    // Mobile menu toggle
    const navToggle = document.getElementById('navToggle');
    const topNav = document.getElementById('topNav');
    if (navToggle && topNav) {
        navToggle.addEventListener('click', () => {
            const isOpen = topNav.classList.contains('menu-open');
            topNav.classList.toggle('menu-open');
            navToggle.setAttribute('aria-expanded', String(!isOpen));
        });
    }

    // Navigation: page switching
    document.querySelectorAll('.page-button').forEach(btn => {
        btn.addEventListener('click', () => {
            // Close mobile menu when a page is selected
            if (topNav && topNav.classList.contains('menu-open')) {
                topNav.classList.remove('menu-open');
                if (navToggle) {
                    navToggle.setAttribute('aria-expanded', 'false');
                }
            }
            const page = btn.getAttribute('data-page');
            if (page) {
                app.switchPage(page);
            }
        });
    });

    // Tab switching within the Results section (Tabular / Calendar / Chart)
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            if (tab) {
                app.switchTab(tab);
            }
        });
    });

    // Target payoff date panel: collapse/expand toggle
    const targetToggle = document.getElementById('targetDateToggle');
    const targetBody = document.getElementById('targetDateBody');
    if (targetToggle && targetBody) {
        targetToggle.addEventListener('click', () => {
            const expanded = targetToggle.getAttribute('aria-expanded') === 'true';
            targetToggle.setAttribute('aria-expanded', String(!expanded));
            targetBody.hidden = expanded;
        });
    }

    // Plan History panel: collapse/expand toggle
    const planHistoryToggle = document.getElementById('planHistoryToggle');
    const planHistoryBodyWrap = document.getElementById('planHistoryBodyWrap');
    if (planHistoryToggle && planHistoryBodyWrap) {
        planHistoryToggle.addEventListener('click', () => {
            const expanded = planHistoryToggle.getAttribute('aria-expanded') === 'true';
            planHistoryToggle.setAttribute('aria-expanded', String(!expanded));
            planHistoryBodyWrap.hidden = expanded;
        });
    }

    // Main plan: calculate using monthly payment + selected strategy
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', () => {
            app.calculatePaymentPlanFromInputs();
        });
    }

    // Suggest payment button
    const suggestPaymentBtn = document.getElementById('suggestPaymentBtn');
    if (suggestPaymentBtn) {
        suggestPaymentBtn.addEventListener('click', () => {
            app.suggestMonthlyPayment();
        });
    }

    // Debt form submit and related controls
    const debtForm = document.getElementById('debtForm');
    if (debtForm) {
        debtForm.addEventListener('submit', e => {
            e.preventDefault();
            if (app.editingDebtId) {
                app.saveEdit();
            } else {
                app.addDebt();
            }
        });
    }

    const debtType = document.getElementById('debtType');
    if (debtType) {
        debtType.addEventListener('change', () => app.updateFormVisibility());
    }

    document.getElementById('accountType')?.addEventListener('change', updateAccountFormRetirementVisibility);
    document.getElementById('accountRetirementSubtype')?.addEventListener('change', updateAccountFormRetirementVisibility);

    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => app.renderDebtsList());
    }

    const debtInterestFilter = document.getElementById('debtInterestFilter');
    if (debtInterestFilter) {
        debtInterestFilter.addEventListener('change', () => app.renderDebtsList());
    }

    ['debtSortBy', 'debtAccountFilter', 'debtProgressFilter', 'debtUtilizationFilter', 'debtGroupBy'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => app.renderDebtsList());
    });

    ['recurringSortBy', 'recurringCategoryFilter', 'recurringAccountFilter', 'recurringMonthFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => app.renderRecurringPage());
    });

    ['accountSortBy', 'accountTypeFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => app.renderAccountsList());
    });

    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', () => app.cancelEdit());
    }

    // Target payoff date: "Calculate" button runs back-calculation
    const calcTargetBtn = document.getElementById('calcTargetBtn');
    if (calcTargetBtn) {
        calcTargetBtn.addEventListener('click', () => {
            try {
                app.calculateRequiredPayment();
            } catch (err) {
                console.error('Error invoking calculateRequiredPayment from click handler', err);
                const resultEl = document.getElementById('targetPayoffResult');
                if (resultEl) resultEl.innerHTML = `<div class="target-result target-result--error">Error: ${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
            }
        });
    }

    const clearDataBtn = document.getElementById('clearDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', async () => {
            const confirmed = await showDeleteConfirmModal(
                'Clear ALL app data? This will permanently remove accounts, debts, income, bonuses, bills, expenses, plans, ledger overrides, and theme preference.',
                'Clear All Data'
            );
            if (confirmed) {
                app.clearAllData();
            }
        });
    }

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => app.exportToCSV());
    }

    const exportScheduleBtn = document.getElementById('exportScheduleBtn');
    if (exportScheduleBtn) {
        exportScheduleBtn.addEventListener('click', () => app.exportPaymentScheduleCSV());
    }

    const accountForm = document.getElementById('accountForm');
    if (accountForm) {
        accountForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addAccount();
        });
    }

    const incomeForm = document.getElementById('incomeForm');
    if (incomeForm) {
        incomeForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addIncome();
        });
    }

    const personForm = document.getElementById('personForm');
    if (personForm) {
        personForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addPerson();
        });
    }

    const expenseForm = document.getElementById('expenseForm');
    if (expenseForm) {
        expenseForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addExpense();
        });
    }

    const bonusForm = document.getElementById('bonusForm');
    if (bonusForm) {
        bonusForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addBonus();
        });
    }

    const bonusAdviceBtn = document.getElementById('bonusAdviceBtn');
    if (bonusAdviceBtn) {
        bonusAdviceBtn.addEventListener('click', () => {
            app.showBonusAdvice();
        });
    }

    const recurringForm = document.getElementById('recurringForm');
    if (recurringForm) {
        recurringForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addRecurringTemplate();
        });
    }

    const recurringFormToggle = document.getElementById('recurringFormToggle');
    const recurringFormBody = document.getElementById('recurringFormBody');
    if (recurringFormToggle && recurringFormBody) {
        recurringFormToggle.addEventListener('click', () => {
            const open = !recurringFormBody.hidden;
            recurringFormBody.hidden = open;
            recurringFormToggle.setAttribute('aria-expanded', String(!open));
            recurringFormToggle.classList.toggle('recurring-form-toggle--open', !open);
        });
    }

    const expenseDateInput = document.getElementById('expenseDate');
    if (expenseDateInput && !expenseDateInput.value) {
        expenseDateInput.value = new Date().toISOString().split('T')[0];
    }

    const debtFormToggle = document.getElementById('debtFormToggle');
    const debtFormBody = document.getElementById('debtFormBody');
    if (debtFormToggle && debtFormBody) {
        const openForm = () => {
            debtFormBody.hidden = false;
            debtFormToggle.setAttribute('aria-expanded', 'true');
            debtFormToggle.classList.add('debt-form-toggle--open');
        };
        const closeForm = () => {
            debtFormBody.hidden = true;
            debtFormToggle.setAttribute('aria-expanded', 'false');
            debtFormToggle.classList.remove('debt-form-toggle--open');
        };
        debtFormToggle.addEventListener('click', () => {
            if (debtFormBody.hidden) openForm();
            else closeForm();
        });

        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                const titleEl = document.getElementById('debtFormTitle');
                if (titleEl) titleEl.textContent = 'Add New Debt';
                closeForm();
            }, true);
        }

        window.openDebtForm = openForm;
        window.closeDebtForm = closeForm;
    }

    const makeBudgetToggle = (toggleId, bodyId) => {
        const toggle = document.getElementById(toggleId);
        const body = document.getElementById(bodyId);
        if (!toggle || !body) return;
        toggle.addEventListener('click', () => {
            const open = !body.hidden;
            body.hidden = open;
            toggle.setAttribute('aria-expanded', String(!open));
            toggle.classList.toggle('budget-form-toggle--open', !open);
        });
    };
    makeBudgetToggle('expenseFormToggle', 'expenseFormBody');

    const bonusFormToggle = document.getElementById('bonusFormToggle');
    const bonusFormBody = document.getElementById('bonusFormBody');
    if (bonusFormToggle && bonusFormBody) {
        bonusFormToggle.addEventListener('click', () => {
            const open = !bonusFormBody.hidden;
            bonusFormBody.hidden = open;
            bonusFormToggle.setAttribute('aria-expanded', String(!open));
            bonusFormToggle.classList.toggle('bonus-form-toggle--open', !open);
        });
    }

    document.querySelectorAll('.results-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-rtab');
            document.querySelectorAll('.results-tab-btn').forEach(b => {
                const active = b === btn;
                b.classList.toggle('results-tab-btn--active', active);
                b.setAttribute('aria-selected', String(active));
            });
            document.querySelectorAll('.results-tab-panel').forEach(panel => {
                panel.classList.toggle('results-tab-panel--active', panel.id === `rPanel-${target}`);
            });
        });
    });

    document.querySelectorAll('.rpt-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-rptab');
            document.querySelectorAll('.rpt-tab-btn').forEach(b => {
                const active = b === btn;
                b.classList.toggle('rpt-tab-btn--active', active);
                b.setAttribute('aria-selected', String(active));
            });
            document.querySelectorAll('.rpt-tab-panel').forEach(panel => {
                panel.classList.toggle('rpt-tab-panel--active', panel.id === `rptPanel-${target}`);
            });
            app.renderReportsPage();
        });
    });

    const rptPrevMonth = document.getElementById('rptPrevMonth');
    if (rptPrevMonth) {
        rptPrevMonth.addEventListener('click', () => app.prevReportMonth());
    }
    const rptNextMonth = document.getElementById('rptNextMonth');
    if (rptNextMonth) {
        rptNextMonth.addEventListener('click', () => app.nextReportMonth());
    }
    const rptPrintBtn = document.getElementById('rptPrintBtn');
    if (rptPrintBtn) {
        rptPrintBtn.addEventListener('click', () => window.print());
    }
    const accountsPrintBtn = document.getElementById('accountsPrintBtn');
    if (accountsPrintBtn) {
        accountsPrintBtn.addEventListener('click', () => window.print());
    }
    const incomePrintBtn = document.getElementById('incomePrintBtn');
    if (incomePrintBtn) {
        incomePrintBtn.addEventListener('click', () => window.print());
    }
    const liabilitiesPrintBtn = document.getElementById('liabilitiesPrintBtn');
    if (liabilitiesPrintBtn) {
        liabilitiesPrintBtn.addEventListener('click', () => window.print());
    }
    const recurringPrintBtn = document.getElementById('recurringPrintBtn');
    if (recurringPrintBtn) {
        recurringPrintBtn.addEventListener('click', () => window.print());
    }
    const strategyPrintBtn = document.getElementById('strategyPrintBtn');
    if (strategyPrintBtn) {
        strategyPrintBtn.addEventListener('click', () => window.print());
    }
    const ledgerPrintBtn = document.getElementById('ledgerPrintBtn');
    if (ledgerPrintBtn) {
        ledgerPrintBtn.addEventListener('click', () => window.print());
    }

    document.addEventListener('click', event => {
        const rangeBtn = event.target.closest('[data-networth-range]');
        if (rangeBtn) {
            const nextRange = parseInt(rangeBtn.getAttribute('data-networth-range'), 10);
            if ([3, 6, 12].includes(nextRange)) {
                app._netWorthRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const projectionBtn = event.target.closest('[data-networth-projection]');
        if (projectionBtn) {
            const nextYears = parseInt(projectionBtn.getAttribute('data-networth-projection'), 10);
            if ([1, 3, 5].includes(nextYears)) {
                app._netWorthProjectionYears = nextYears;
                app.renderReportsPage();
            }
            return;
        }

        const cashFlowRangeBtn = event.target.closest('[data-cashflow-range]');
        if (cashFlowRangeBtn) {
            const nextRange = parseInt(cashFlowRangeBtn.getAttribute('data-cashflow-range'), 10);
            if ([1, 3, 6, 12].includes(nextRange)) {
                app._cashFlowTrendRangeMonths = nextRange;
                app.renderReportsPage();
            }
            return;
        }

        const forecastRangeBtn = event.target.closest('[data-forecast-range]');
        if (forecastRangeBtn) {
            const nextRange = parseInt(forecastRangeBtn.getAttribute('data-forecast-range'), 10);
            if ([1, 2, 3, 6, 12].includes(nextRange)) {
                app._forecastRangeMonths = nextRange;
                app.saveToStorage();
                app.renderReportsPage();
            }
            return;
        }

        const captureBtn = event.target.closest('#captureSnapshotBtn');
        if (captureBtn) {
            app.captureNetWorthSnapshot({ source: 'manual' });
            app.renderReportsPage();
            app.renderNetWorthWidget();
        }

        const summaryRangeBtn = event.target.closest('[data-rpt-summary-range]');
        if (summaryRangeBtn) {
            const next = summaryRangeBtn.getAttribute('data-rpt-summary-range');
            if (next === 'month' || next === 'year') {
                app._reportSummaryRange = next;
                app.renderReportsPage();
            }
            return;
        }
    });

    const amortizationModal = document.getElementById('amortizationModal');
    const closeAmortizationBtn = document.getElementById('closeAmortization');
    const exportAmortizationBtn = document.getElementById('exportAmortizationBtn');
    let lastFocused = null;
    if (amortizationModal && closeAmortizationBtn) {
        amortizationModal.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
        amortizationModal.classList.add('hidden'); amortizationModal.classList.remove('flex-visible');
                if (lastFocused) lastFocused.focus();
            }
            if (event.key === 'Tab') {
                const focusable = amortizationModal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
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
        });

        const origShowAmortizationModal = app.showAmortizationModal.bind(app);
        app.showAmortizationModal = (debtName) => {
            lastFocused = document.activeElement;
            origShowAmortizationModal(debtName);
            setTimeout(() => closeAmortizationBtn.focus(), 0);
        };

        closeAmortizationBtn.addEventListener('click', () => {
            amortizationModal.classList.add('hidden');
            amortizationModal.classList.remove('flex-visible');
            if (lastFocused) lastFocused.focus();
        });
    }

    if (exportAmortizationBtn) {
        exportAmortizationBtn.addEventListener('click', () => {
            const title = (document.getElementById('amortizationTitle')?.textContent || '').trim();
            const wrapper = document.getElementById('amortizationTableWrapper');
            const table = wrapper?.querySelector('table');
            if (!table) return;

            const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
            const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr =>
                Array.from(tr.querySelectorAll('td')).map(td => `"${td.textContent.trim()}"`).join(',')
            );
            const csv = `${headers.join(',')}\n${rows.join('\n')}\n`;

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'amortization') + '.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        });
    }

    // Account menu dropdown
    initAccountMenu(app);
}

export function navigateToReportsCalendar(app) {
    document.querySelectorAll('.rpt-tab-btn').forEach(b => {
        const active = b.getAttribute('data-rptab') === 'calendar';
        b.classList.toggle('rpt-tab-btn--active', active);
        b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.rpt-tab-panel').forEach(p => {
        p.classList.toggle('rpt-tab-panel--active', p.id === 'rptPanel-calendar');
    });
    app.switchPage('reports');
}

export function updateAccountMenuEmail(app) {
    const emailEl = document.getElementById('accountMenuEmail');
    const logoutItem = document.getElementById('accountMenuLogoutBtn');
    if (emailEl) {
        if (app.userEmail) {
            emailEl.textContent = app.userEmail;
            emailEl.classList.remove('hidden');
        } else {
            emailEl.textContent = '';
            emailEl.classList.add('hidden');
        }
    }
    if (logoutItem) {
        logoutItem.classList.toggle('hidden', app._storageBackendKind !== 'postgres');
    }
}

export function initAccountMenu(app) {
    const wrap = document.getElementById('accountMenuWrap');
    const btn = document.getElementById('accountMenuBtn');
    const dropdown = document.getElementById('accountMenuDropdown');
    if (!wrap || !btn || !dropdown) return;

    const whatsNewItem = document.getElementById('accountMenuWhatsNewBtn');
    const calendarFeedItem = document.getElementById('accountMenuCalendarFeedBtn');
    const backupItem = document.getElementById('accountMenuBackupBtn');
    const settingsItem = document.getElementById('accountMenuSettingsBtn');
    const shortcutsItem = document.getElementById('accountMenuShortcutsBtn');
    const logoutItem = document.getElementById('accountMenuLogoutBtn');

    updateAccountMenuEmail(app);

    const close = () => {
        dropdown.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
        dropdown.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
    };
    const toggle = () => dropdown.classList.contains('hidden') ? open() : close();

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

    if (whatsNewItem) whatsNewItem.addEventListener('click', () => { close(); openWhatsNewModal(); });

    // Proxy menu items to the hidden legacy buttons
    if (calendarFeedItem) calendarFeedItem.addEventListener('click', () => { close(); document.getElementById('calendarFeedBtn')?.click(); });
    if (backupItem) backupItem.addEventListener('click', () => { close(); document.getElementById('dataTransferBtn')?.click(); });
    if (settingsItem) settingsItem.addEventListener('click', () => { close(); document.getElementById('settingsBtn')?.click(); });
    // Focus the (still visible) menu trigger first so closing the panel returns focus there.
    if (shortcutsItem) shortcutsItem.addEventListener('click', () => { close(); btn.focus(); app.openKeyboardShortcuts(); });
    if (logoutItem) {
        logoutItem.addEventListener('click', async () => {
            close();
            try {
                const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('csrf='))?.split('=')[1] || '';
                await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, credentials: 'include' });
            } catch (_) { /* ignore */ }
            location.reload();
        });
    }

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) close();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });
}

export function switchTab(app, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-selected', 'false');
    });

    const activeTabPanel = document.getElementById(`${tabName}-tab`);
    if (activeTabPanel) {
        activeTabPanel.classList.add('active');
    }

    const activeTabButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
        activeTabButton.setAttribute('aria-selected', 'true');
    }

    if (tabName === 'chart') {
        app.renderPayoffGanttChart();
        app.renderBalanceChart();
        app.renderProgressChart();
        app.renderPieChart();
        app.renderDebtDistributionChart();
        app.renderDebtToIncomeChart();
    }
    if (tabName === 'calendar') {
        app.renderCalendarView();
    }
}

export function updateFormVisibility() {
    const debtType = document.getElementById('debtType').value;
    const creditCardFields = document.querySelectorAll('.credit-card-field');
    const fixedAmountFields = document.querySelectorAll('.fixed-amount-field');
    const fixedAmountFieldsContainer = document.getElementById('fixedAmountFieldsContainer');
    const fixedEndDateContainer = document.getElementById('fixedEndDateContainer');
    const requiredCreditCardIds = new Set(['accountBalance', 'interestRate', 'minimumPayment', 'dueDate']);

    if (debtType === 'creditCard') {
        creditCardFields.forEach(field => {
            field.classList.remove('hidden'); field.classList.add('visible');
            field.required = requiredCreditCardIds.has(field.id);
        });
        fixedAmountFields.forEach(field => {
            field.classList.add('hidden'); field.classList.remove('visible');
            field.required = false;
        });
        fixedAmountFieldsContainer.classList.add('hidden'); fixedAmountFieldsContainer.classList.remove('visible');
        fixedEndDateContainer.classList.add('hidden'); fixedEndDateContainer.classList.remove('visible');
    } else if (debtType === 'fixedAmount') {
        creditCardFields.forEach(field => {
            field.classList.add('hidden'); field.classList.remove('visible');
            field.required = false;
        });
        fixedAmountFields.forEach(field => {
            field.classList.remove('hidden'); field.classList.add('visible');
            field.required = true;
        });
        fixedAmountFieldsContainer.classList.remove('hidden'); fixedAmountFieldsContainer.classList.add('visible');
        fixedEndDateContainer.classList.remove('hidden'); fixedEndDateContainer.classList.add('visible');
    }
}

export function switchLiabilitiesSubTab(app, subTab) {
    app.liabilitiesSubTab = subTab;
    const section = document.getElementById('liabilitiesSection');
    if (!section) return;

    // Update button states
    section.querySelectorAll('.liabilities-subtab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.liabilitiesSubtab === subTab);
    });

    // Show/hide panels
    section.querySelectorAll('.liabilities-subtab-panel').forEach(panel => {
        panel.classList.toggle('visible', panel.dataset.subtab === subTab);
        panel.classList.toggle('hidden', panel.dataset.subtab !== subTab);
    });
}

export function attachLiabilitiesEventListeners(app) {
    const section = document.getElementById('liabilitiesSection');
    if (!section) return;

    // Subtab switching
    section.querySelectorAll('.liabilities-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            app.switchLiabilitiesSubTab(btn.dataset.liabilitiesSubtab);
        });
    });
}

export function switchPage(app, pageName) {
    // #315: the Spending-to-Ledger cross-nav breadcrumb only makes sense
    // while still looking at the Ledger page it dropped you into — clear it
    // the moment you navigate anywhere else, so a later plain nav back into
    // Ledger doesn't show stale "Viewing: ..." context. Also restore the
    // account/date-range filters the cross-nav overrode to 'all' back to
    // whatever they were before it (saved by spending.js's "View in Ledger"
    // handler), regardless of which path the user takes out of Ledger —
    // not just the dedicated "Back to Spending" button.
    if (pageName !== 'ledger' && app._ledgerCrossNavLabel) {
        app._ledgerCrossNavLabel = null;
        app._ledgerAccountFilter = app._ledgerPreCrossNavAccount ?? 'all';
        app._ledgerDateRange = app._ledgerPreCrossNavDateRange ?? 'around7';
        app._ledgerPreCrossNavAccount = undefined;
        app._ledgerPreCrossNavDateRange = undefined;
    }

    document.querySelectorAll('.page-button').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-current', 'false');
    });
    const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
    }

    const mapping = {
        health: 'healthSection',
        accounts: 'accountsSection',
        liabilities: 'liabilitiesSection',
        income: 'incomeSection',
        savings: 'savingsSection',
        strategy: 'strategySection',
        reports: 'reportsSection',
        ledger: 'ledgerSection',
        recurring: 'recurringSection',
        reconcile: 'reconcileSection',
        retirement: 'retirementSection',
        people: 'peopleSection'
    };

    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

    const id = mapping[pageName];
    if (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    app._currentPage = pageName;
    renderPageData(app, pageName);
}

/**
 * Render whichever data a page needs, without touching nav/section visibility.
 * Called by `switchPage()` when navigating into a page, and by
 * `refreshCurrentPageData()` (see app.js) to re-render the currently visible
 * page in place after data changes underneath it (e.g. a JSON import).
 *
 * `resetToDefaults` controls view-state resets that only make sense when
 * actually navigating into the page (Liabilities defaulting to its Debts
 * subtab, Reports resetting its month offset) — an in-place refresh leaves
 * those alone so the user's current view isn't yanked out from under them.
 */
export function renderPageData(app, pageName, { resetToDefaults = true } = {}) {
    if (pageName === 'health') app.renderHealthDashboard();
    if (pageName === 'accounts') {
        app.renderAccountsList();
        app.renderNetWorthWidget();
        updateAccountFormRetirementVisibility();
    }
    if (pageName === 'liabilities') {
        // Render both debts and expenses
        app.renderDebtsList();
        if (resetToDefaults) app._expenseMonthOffset = 0;
        app.renderBudgetPage();
        refreshAccountSelectors(app);
        refreshPersonSelectors(app);
        // Attach liabilities subtab listeners
        attachLiabilitiesEventListeners(app);
        // Default to debts subtab
        if (resetToDefaults) app.switchLiabilitiesSubTab('debts');
    }
    if (pageName === 'income') { app.renderIncomeList(); app.renderBonusList(); refreshAccountSelectors(app); refreshPersonSelectors(app); refreshCategoryDatalist(app); }
    if (pageName === 'savings') {
        app.renderSavingsPage();
        app.attachSavingsEventListeners();
    }
    if (pageName === 'strategy') { app.renderStrategyIncomeWidget(); app.renderPlanHistory(); }
    if (pageName === 'reports') {
        if (resetToDefaults) app._reportMonthOffset = 0;
        app.renderReportsPage();
    }
    if (pageName === 'ledger') {
        renderLedgerPage(app);
    }
    if (pageName === 'recurring') {
        app.refreshRecurringAccountSelectors();
        app.renderRecurringPage();
    }
    if (pageName === 'reconcile') {
        app.renderReconciliationPage();
    }
    if (pageName === 'retirement') {
        app.renderRetirementPage();
    }
    if (pageName === 'people') {
        app.renderPeopleList();
        app.refreshPersonSelectors();
    }
}

export function updateUI(app) {
    if (app._savedMonthlyPayment) {
        const mpEl = document.getElementById('monthlyPayment');
        if (mpEl && !mpEl.value) mpEl.value = app._savedMonthlyPayment;
    }
    if (app._savedStrategy) {
        const stratEl = document.getElementById('paymentStrategy');
        if (stratEl) stratEl.value = app._savedStrategy;
    }
    app.restoreLastPlan();
    app.renderPlanHistory();

    if (app.debts.length === 0) {
        document.getElementById('emptyState').classList.add('visible'); document.getElementById('emptyState').classList.remove('hidden');
    } else {
        document.getElementById('emptyState').classList.add('hidden'); document.getElementById('emptyState').classList.remove('visible');
    }

    app.renderDebtsList();
    app.renderNetWorthWidget();
}

export function showMilestone(debtName) {
    const host = document.createElement('div');
    host.className = 'milestone-host';

    const toast = document.createElement('div');
    toast.className = 'milestone-toast';
    toast.textContent = `${debtName} paid off today`;
    host.appendChild(toast);

    const colors = ['#2563eb', '#059669', '#f59e0b', '#dc2626', '#7c3aed'];
    const count = 24;
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('span');
        piece.className = 'milestone-confetti';
        const angle = (Math.PI * 2 * i) / count;
        const distance = 120 + Math.random() * 180;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance - 40;
        // setProperty is CSP-safe — it mutates the CSSOM from JS, not an inline style attribute
        piece.style.setProperty('--confetti-x', `${x}px`);
        piece.style.setProperty('--confetti-y', `${y}px`);
        piece.style.setProperty('--confetti-w', `${6 + Math.random() * 6}px`);
        piece.style.setProperty('--confetti-h', `${10 + Math.random() * 8}px`);
        piece.style.setProperty('--confetti-ml', `-${3 + Math.random() * 3}px`);
        piece.style.setProperty('--confetti-bg', colors[i % colors.length]);
        piece.style.setProperty('--confetti-dur', `${1100 + Math.random() * 500}ms`);
        piece.style.setProperty('--confetti-rot', `${360 + i * 18}deg`);
        host.appendChild(piece);
    }

    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), 1800);
}

export function showStorageQuotaWarning(usage) {
    if (document.getElementById('storageQuotaBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'storageQuotaBanner';
    banner.className = 'storage-quota-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('span');
    if (usage.writeFailed) {
        text.textContent = 'Your saved data could not be written to browser storage — it may be full. Export a backup now to avoid losing data.';
    } else {
        const mb = (usage.bytes / (1024 * 1024)).toFixed(1);
        const pct = Math.round(usage.pct * 100);
        text.textContent = `Your saved data is using about ${mb} MB (${pct}% of typical browser storage limits). Consider exporting a backup and trimming old records.`;
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'storage-quota-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss storage warning');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => banner.remove());

    banner.appendChild(text);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
}

export function showUpdateAvailableBanner(waitingWorker) {
    if (document.getElementById('swUpdateBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'swUpdateBanner';
    banner.className = 'sw-update-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('span');
    text.textContent = 'A new version of MyFinances is available.';

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'sw-update-banner-reload';
    reloadBtn.textContent = 'Reload';
    reloadBtn.addEventListener('click', () => waitingWorker.postMessage({ type: 'SKIP_WAITING' }));

    const closeBtn = document.createElement('button');
    closeBtn.className = 'sw-update-banner-close';
    closeBtn.setAttribute('aria-label', 'Dismiss update notice');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => banner.remove());

    banner.appendChild(text);
    banner.appendChild(reloadBtn);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
}

export function checkWhatsNew(isFirstRun) {
    let seen;
    try { seen = localStorage.getItem(LAST_SEEN_VERSION_KEY); } catch (_) { return; }
    if (isFirstRun) {
        // New install — set the current version silently, no notification
        try { localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION); } catch (_) {}
        return;
    }
    const hasNew = seen !== APP_VERSION;
    _setWhatsNewDots(hasNew);
}

export function openWhatsNewModal() {
    try { localStorage.setItem(LAST_SEEN_VERSION_KEY, APP_VERSION); } catch (_) {}
    _setWhatsNewDots(false);
    const modal = document.getElementById('whatsNewModal');
    if (!modal) return;
    const body = document.getElementById('whatsNewModalBody');
    if (body) body.innerHTML = _buildWhatsNewHtml();
    modal.classList.remove('hidden');
    modal.focus();
    const closeBtn = document.getElementById('whatsNewModalCloseBtn');
    const closeHandler = () => {
        modal.classList.add('hidden');
        closeBtn?.removeEventListener('click', closeHandler);
        modal.removeEventListener('click', overlayHandler);
    };
    const overlayHandler = (e) => { if (e.target === modal) closeHandler(); };
    closeBtn?.addEventListener('click', closeHandler);
    modal.addEventListener('click', overlayHandler);
}

function _setWhatsNewDots(visible) {
    document.getElementById('accountMenuNotifDot')?.classList.toggle('account-menu-notif-dot--visible', visible);
    document.getElementById('whatsNewMenuDot')?.classList.toggle('account-menu-notif-dot--visible', visible);
}

function _buildWhatsNewHtml() {
    return `<div class="wn-version">v${escapeHtml(APP_VERSION)}</div>` + WHATS_NEW_ENTRIES.map(entry => `
        <div class="wn-section">
            <h4 class="wn-version-heading">${escapeHtml(entry.version)}</h4>
            <ul class="wn-list">
                ${entry.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
        </div>`).join('');
}

// Statically embed the last few versions' highlights.
// Update this list every version bump alongside CHANGELOG.md.
const WHATS_NEW_ENTRIES = [
    {
        version: '6.35.0 — 2026-10-25',
        items: [
            '<strong>Plan: visual payoff Gantt chart</strong> (issue #314) — the Plan page\'s Chart View tab adds a "Debt Elimination Timeline" chart showing each debt\'s payoff span at a glance.'
        ]
    },
    {
        version: '6.34.0 — 2026-10-25',
        items: [
            '<strong>Accounts: balance breakdown drill-down</strong> (issue #257) — click "See breakdown" on any account\'s projected balance to see exactly which transactions make it up, with a running balance after each one.'
        ]
    },
    {
        version: '6.33.0 — 2026-10-23',
        items: [
            '<strong>Health: per-card credit utilization breakdown</strong> (issue #281) — see which individual credit card is driving your utilization number, not just the total.',
            '<strong>Reports: Spending → Ledger cross-navigation</strong> (issue #315) — jump straight from a spending category to its transactions in the Ledger.',
            '<strong>Settings: tabbed layout</strong> (issue #322) — reorganized into Appearance, Data & Storage, Notifications, and Advanced tabs so it\'s easier to find what you need.'
        ]
    },
    {
        version: '6.32.0 — 2026-10-23',
        items: [
            '<strong>Health: multi-model DTI view</strong> (issue #253) — the Debt-to-Income card now shows Mortgage Front-End and Back-End ratios alongside the existing Consumer DTI, with an editable "Est. monthly housing cost" field.',
            '<strong>Health: customizable budget category thresholds</strong> (issue #250) — a gear button on the Budget Allocation card opens a modal to set your own healthy/warning % thresholds per category, with a one-click reset to defaults.'
        ]
    },
    {
        version: '6.31.0 — 2026-10-22',
        items: [
            '<strong>Year-over-year spending comparison</strong> (issue #332) — the Spending Analysis report adds a "Compare:" toggle to switch each category\'s change badge between "vs. last month" and "vs. same month last year".',
            '<strong>Income Trend chart</strong> (issue #262) — the Income page adds a stacked bar chart of Regular Income vs. Bonuses over a trailing 12/24-month range, with an optional year-over-year overlay line.',
            '<strong>Net worth trajectory projection</strong> (issue #335) — the Net Worth report\'s trend chart now extends forward 1/3/5 years as a dashed projection, with year-end milestone cards below the chart.'
        ]
    },
    {
        version: '6.30.0 — 2026-10-22',
        items: [
            '<strong>Retirement: monthly income in retirement</strong> (issue #345) — the Retirement page\'s projection panel now shows an estimated monthly income in retirement, based on a configurable 2%–8% safe withdrawal rate slider.'
        ]
    },
    {
        version: '6.29.0 — 2026-10-22',
        items: [
            '<strong>JSON import error surface</strong> (issue #291) — importing a backup now reports exactly what happened to every record (coerced fields, dropped records) in a collapsible list, instead of a generic success/failure message.',
            '<strong>Modal focus-trap coverage</strong> (issue #310) — confirmed and extended Tab-trap/focus-restore test coverage across the Ledger Export, Ledger Mark-All-Cleared, and Reports Calendar day-detail modals.'
        ]
    },
    {
        version: '6.28.0 — 2026-10-22',
        items: [
            '<strong>Health "Top recommendations" panel</strong> (issue #254) — the Health page now surfaces up to 3 ranked, actionable recommendations drawn from your DTI, savings rate, emergency fund, payoff timeline, cash flow, and credit utilization.',
            '<strong>Liabilities "Group by" (Person / Institution)</strong> (issue #288) — group the Debts list by linked person or by institution (derived from the debt name), each with a count/total header.'
        ]
    },
    {
        version: '6.27.0 — 2026-10-22',
        items: [
            '<strong>Debt payoff celebration flow</strong> (issue #294) — paying off a debt now opens a congratulations modal with Archive Debt / Keep Active options, instead of a plain Archive button.',
            '<strong>Upcoming-due urgency badge on recurring cards</strong> (issue #382) — recurring template cards show a red/yellow badge when the next occurrence is due within 3 or 7 days.',
            '<strong>Health page stale-plan nudge</strong> (issue #383) — a banner appears on the Health page when you haven\'t updated any debt or income record in 30+ days.'
        ]
    },
    {
        version: '6.26.0 — 2026-10-20',
        items: [
            '<strong>Sinking fund priority ordering + completion flow</strong> (issues #304, #308) — sinking funds can now be ordered, and a fully funded fund shows a "Complete this goal" button (Archive / Delete / Keep Active).',
            '<strong>Empty state CTAs across pages</strong> (issue #276) — Debts, Accounts, Income, Health, and Ledger now show a styled empty state with a call-to-action button when there\'s nothing to show yet.',
            '<strong>Recurring actual-amount override + Ledger cross-navigation</strong> (issues #293, #285) — "Mark as paid" lets you enter the actual amount paid; Ledger rows gain a ↗ button that jumps to the matching source page.',
            '<strong>Minimum payment trap warning + bulk debt actions</strong> (issues #259, #282) — a warning badge appears when a debt would take 36+ months to pay off at the minimum; debt cards gain multi-select Archive/Export/Delete actions.'
        ]
    },
    {
        version: '6.25.0 — 2026-10-19',
        items: [
            '<strong>Bonus Advisor discoverability + next payment due date</strong> (issues #267, #277) — the command palette and Health page surplus section now surface the Bonus Advisor; debts gain an optional "Next Payment Due" date field.',
            '<strong>Category autocomplete + Strategy plan stale warning</strong> (issues #298, #325) — Recurring/Expenses category fields are now autocomplete inputs; the Plan page warns when your debt data has changed since the last calculation.',
            '<strong>Ledger filter persistence</strong> (issue #338) — Ledger account/date-range/cleared/page-size filters are now remembered across visits.'
        ]
    },
    {
        version: '6.24.0 — 2026-10-19',
        items: [
            '<strong>S-01 — Emergency fund auto-sync</strong> (issue #313) — Emergency fund records can now link to an account and automatically reflect the account\'s projected balance. Enable "Auto-sync balance from linked account" on any emergency fund. The current-amount field disables when auto-sync is on, and the card shows a ⟳ synced indicator. The manual + Contribute button is hidden when auto-sync is active.',
            '<strong>U-01 — What\'s New notification</strong> (issue #289) — A notification dot on the account menu button now appears after each version upgrade. Clicking "What\'s New" in the account menu opens this panel showing recent changes. The dot is cleared when you dismiss the panel. New installs skip the notification.'
        ]
    },
    {
        version: '6.23.0 — 2026-10-19',
        items: [
            '<strong>L-02 — Ledger bulk clear/unclear</strong> (issue #266) — Select one or more ledger rows via checkboxes and use the Bulk Actions bar to mark them cleared or unclear in one click.',
            '<strong>P-01 — Per-person financial summary card</strong> (issue #284) — People page cards now show Annual Income, Total Debt, Monthly Net, and Credit Utilization KPI tiles with color-coded health badges.'
        ]
    }
];

export function showNetWorthMilestone(message) {
    const host = document.createElement('div');
    host.className = 'networth-milestone-host';

    const toast = document.createElement('div');
    toast.className = 'networth-milestone-toast';
    toast.textContent = message;
    host.appendChild(toast);

    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), 2600);
}

let _pgErrorToastTimer = null;

export function showPgErrorToast() {
    if (_pgErrorToastTimer !== null) {
        clearTimeout(_pgErrorToastTimer);
    } else {
        const el = document.createElement('div');
        el.id = 'pgErrorToast';
        el.className = 'pg-error-toast';
        el.setAttribute('role', 'alert');
        el.textContent = 'Sync error — your change may not have been saved to the server.';
        document.body.appendChild(el);
    }
    _pgErrorToastTimer = setTimeout(() => {
        document.getElementById('pgErrorToast')?.remove();
        _pgErrorToastTimer = null;
    }, 5000);
}

let _emailTestToastTimer = null;

export function showEmailTestToast(status, message) {
    if (_emailTestToastTimer !== null) {
        clearTimeout(_emailTestToastTimer);
        document.getElementById('emailTestToast')?.remove();
    }
    const el = document.createElement('div');
    el.id = 'emailTestToast';
    el.className = `email-test-toast email-test-toast--${status}`;
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    _emailTestToastTimer = setTimeout(() => {
        document.getElementById('emailTestToast')?.remove();
        _emailTestToastTimer = null;
    }, 5000);
}

export function showDeleteConfirmModal(message, confirmLabel = 'Delete') {
    return new Promise((resolve) => {
        const modal = document.getElementById('deleteConfirmModal');
        const messageEl = document.getElementById('deleteConfirmMessage');
        const confirmBtn = document.getElementById('deleteConfirmBtn');
        const cancelBtn = document.getElementById('deleteConfirmCancelBtn');
        if (!modal) { resolve(false); return; }
        if (confirmBtn) confirmBtn.textContent = confirmLabel;

        if (messageEl) messageEl.textContent = message;

        const lastFocused = document.activeElement;
        const dismiss = (result) => {
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
            resolve(result);
        };

        confirmBtn.onclick = () => dismiss(true);
        cancelBtn.onclick = () => dismiss(false);
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return; }
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

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.focus();  // immediate focus ensures onkeydown fires for Escape
        setTimeout(() => cancelBtn.focus(), 30);
    });
}

export function showArchiveConfirmModal(debtName) {
    return new Promise((resolve) => {
        const modal = document.getElementById('archiveConfirmModal');
        const messageEl = document.getElementById('archiveConfirmMessage');
        const confirmBtn = document.getElementById('archiveConfirmBtn');
        const cancelBtn = document.getElementById('archiveConfirmCancelBtn');
        if (!modal) { resolve(false); return; }

        if (messageEl) messageEl.textContent = `Archive "${debtName}"?`;

        const lastFocused = document.activeElement;
        const dismiss = (result) => {
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
            resolve(result);
        };

        confirmBtn.onclick = () => dismiss(true);
        cancelBtn.onclick = () => dismiss(false);
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return; }
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

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.focus();
        setTimeout(() => cancelBtn.focus(), 30);
    });
}

export function showAccountReplacementModal(app, id) {
    return new Promise((resolve) => {
        const modal = document.getElementById('accountReplacementModal');
        const titleEl = document.getElementById('accountReplacementTitle');
        const infoEl = document.getElementById('accountReplacementInfo');
        const linksEl = document.getElementById('accountReplacementLinks');
        const select = document.getElementById('accountReplacementSelect');
        const confirmBtn = document.getElementById('accountReplacementConfirmBtn');
        const cancelBtn = document.getElementById('accountReplacementCancelBtn');
        if (!modal) { resolve(null); return; }

        const account = app.accounts.find(a => a.id === id);
        const otherAccounts = app.accounts.filter(a => a.id !== id);

        const linked = {
            'Income': app.incomes.filter(i => i.accountId === id),
            'Bonuses': (app.bonuses || []).filter(b => b.accountId === id),
            'Debts': app.debts.filter(d => d.accountId === id),
            'Bills': app.bills.filter(b => b.accountId === id),
            'Expenses': app.expenses.filter(e => e.accountId === id),
            'Recurring Transfers': (app.recurringTemplates || []).filter(r => r.accountId === id || r.targetAccountId === id),
        };

        if (titleEl) titleEl.textContent = `Delete Account: ${account?.name ?? ''}`;
        if (infoEl) infoEl.textContent = 'This account has linked items. Select a replacement account before deleting.';

        if (linksEl) {
            linksEl.innerHTML = Object.entries(linked)
                .filter(([, items]) => items.length > 0)
                .map(([label, items]) =>
                    `<div class="acct-replacement-group"><strong>${escapeHtml(label)}:</strong> ${items.map(i => escapeHtml(i.name)).join(', ')}</div>`)
                .join('');
        }

        if (select) {
            select.innerHTML = [
                `<option value="">— Select a replacement account —</option>`,
                ...otherAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`),
            ].join('');
        }
        if (confirmBtn) confirmBtn.disabled = true;

        const onSelectChange = () => { if (confirmBtn) confirmBtn.disabled = !select?.value; };
        if (select) select.onchange = onSelectChange;

        const lastFocused = document.activeElement;
        const dismiss = (result) => {
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (select) select.onchange = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
            resolve(result);
        };

        if (confirmBtn) confirmBtn.onclick = () => dismiss(parseInt(select.value, 10));
        if (cancelBtn) cancelBtn.onclick = () => dismiss(null);
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); dismiss(null); return; }
            if (event.key === 'Tab') {
                const focusable = modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])');
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

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.focus();
        setTimeout(() => { if (cancelBtn) cancelBtn.focus(); }, 30);
    });
}

// Resolves with: null (cancelled), null also for "unassign" when no other persons,
// or a person id (number) to reassign to, or null for "unassign" from the modal.
export function showPersonReplacementModal(app, personId, otherPersons, linkedDebts) {
    return new Promise((resolve) => {
        const modal = document.getElementById('personReplacementModal');
        const titleEl = document.getElementById('personReplacementTitle');
        const infoEl = document.getElementById('personReplacementInfo');
        const linksEl = document.getElementById('personReplacementLinks');
        const select = document.getElementById('personReplacementSelect');
        const confirmBtn = document.getElementById('personReplacementConfirmBtn');
        const cancelBtn = document.getElementById('personReplacementCancelBtn');
        if (!modal) { resolve(null); return; }

        const person = (app.persons || []).find(p => p.id === personId);
        if (titleEl) titleEl.textContent = `Delete Person: ${person?.name ?? ''}`;
        if (infoEl) infoEl.textContent = 'This person has linked debts. Choose a replacement (or leave blank to unassign).';

        if (linksEl) {
            linksEl.innerHTML = linkedDebts.map(d =>
                `<div class="acct-replacement-group">${escapeHtml(d.name)}</div>`
            ).join('');
        }

        if (select) {
            select.innerHTML = [
                `<option value="">— Unassign these debts —</option>`,
                ...otherPersons.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`),
            ].join('');
        }

        const lastFocused = document.activeElement;
        const dismiss = (result) => {
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
            resolve(result);
        };

        // confirm resolves with the chosen person id (or null to unassign); cancel resolves with undefined
        if (confirmBtn) confirmBtn.onclick = () => dismiss(select?.value ? parseInt(select.value, 10) : null);
        if (cancelBtn) cancelBtn.onclick = () => dismiss(undefined);
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); dismiss(undefined); return; }
            if (event.key === 'Tab') {
                const focusable = modal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])');
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

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.focus();
        setTimeout(() => { if (cancelBtn) cancelBtn.focus(); }, 30);
    });
}

export function showAlertModal(message, title = 'Notice') {
    return new Promise((resolve) => {
        const modal = document.getElementById('alertModal');
        const messageEl = document.getElementById('alertModalMessage');
        const titleEl = document.getElementById('alertModalTitle');
        const okBtn = document.getElementById('alertModalOkBtn');
        if (!modal || !okBtn) { resolve(); return; }

        const lastFocused = document.activeElement;

        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;

        const dismiss = () => {
            okBtn.onclick = null;
            modal.onkeydown = null;
            modal.classList.add('hidden');
            modal.classList.remove('flex-visible');
            if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
            resolve();
        };

        okBtn.onclick = dismiss;
        modal.onkeydown = (event) => {
            if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); dismiss(); return; }
            if (event.key === 'Tab') { event.preventDefault(); okBtn.focus(); }
        };

        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.focus();
        setTimeout(() => okBtn.focus(), 30);
    });
}