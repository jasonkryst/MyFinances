// UI helpers, event listeners, theming
import { renderLedgerPage } from './ledger.js';
import { refreshAccountSelectors } from './accounts.js';

export function initializeEventListeners(app) {
    const themeSwitcher = document.getElementById('themeSwitcher');
    const applyTheme = (theme) => {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        if (themeSwitcher) {
            themeSwitcher.textContent = isDark ? '☀️' : '🌙';
            themeSwitcher.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Toggle dark mode');
        }
    };

    const savedTheme = localStorage.getItem('debtTrackerTheme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
        applyTheme(savedTheme);
    }

    if (themeSwitcher) {
        themeSwitcher.addEventListener('click', () => {
            const nextTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            applyTheme(nextTheme);
            localStorage.setItem('debtTrackerTheme', nextTheme);
        });
    }

    // Navigation: page switching
    document.querySelectorAll('.page-button').forEach(btn => {
        btn.addEventListener('click', () => {
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

    // Main plan: calculate using monthly payment + selected strategy
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', () => {
            app.calculatePaymentPlanFromInputs();
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

    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => app.renderDebtsList());
    }

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
                if (resultEl) resultEl.innerHTML = `<div class="target-result target-result--error">Error: ${err && err.message ? err.message : String(err)}</div>`;
            }
        });
    }

    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => app.exportAllJSON());
    }

    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => {
            window.open('USAGE_GUIDE.html', '_blank');
        });
    }

    const importJsonBtn = document.getElementById('importJsonBtn');
    const importJsonInput = document.getElementById('importJsonInput');
    if (importJsonBtn && importJsonInput) {
        importJsonBtn.addEventListener('click', () => {
            importJsonInput.click();
        });

        importJsonInput.addEventListener('change', () => {
            const [file] = importJsonInput.files || [];
            if (file) {
                app.importAllJSON(file);
            }
            importJsonInput.value = '';
        });
    }

    const clearDataBtn = document.getElementById('clearDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            const confirmed = confirm(
                'Clear ALL app data and preferences?\n\n' +
                'This will permanently remove accounts, debts, income, bonuses, bills, expenses, plans, ledger overrides, saved filters, and theme preference.'
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

    const billForm = document.getElementById('billForm');
    if (billForm) {
        billForm.addEventListener('submit', e => {
            e.preventDefault();
            app.addBill();
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
    makeBudgetToggle('billFormToggle', 'billFormBody');
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

    const amortizationModal = document.getElementById('amortizationModal');
    const closeAmortizationBtn = document.getElementById('closeAmortization');
    const exportAmortizationBtn = document.getElementById('exportAmortizationBtn');
    let lastFocused = null;
    if (amortizationModal && closeAmortizationBtn) {
        amortizationModal.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                amortizationModal.style.display = 'none';
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
            amortizationModal.style.display = 'none';
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
}

export function switchTab(app, tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });

    const activeTabPanel = document.getElementById(`${tabName}-tab`);
    if (activeTabPanel) {
        activeTabPanel.classList.add('active');
    }

    const activeTabButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
    if (activeTabButton) {
        activeTabButton.classList.add('active');
    }

    if (tabName === 'chart') {
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
            field.style.display = '';
            field.required = requiredCreditCardIds.has(field.id);
        });
        fixedAmountFields.forEach(field => {
            field.style.display = 'none';
            field.required = false;
        });
        fixedAmountFieldsContainer.style.display = 'none';
        fixedEndDateContainer.style.display = 'none';
    } else if (debtType === 'fixedAmount') {
        creditCardFields.forEach(field => {
            field.style.display = 'none';
            field.required = false;
        });
        fixedAmountFields.forEach(field => {
            field.style.display = '';
            field.required = true;
        });
        fixedAmountFieldsContainer.style.display = '';
        fixedEndDateContainer.style.display = '';
    }
}

export function switchPage(app, pageName) {
    document.querySelectorAll('.page-button').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
    if (btn) btn.classList.add('active');

    const mapping = {
        accounts: 'accountsSection',
        debts: 'debtsSection',
        income: 'incomeSection',
        budget: 'budgetSection',
        strategy: 'strategySection',
        reports: 'reportsSection',
        ledger: 'ledgerSection'
    };

    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

    const id = mapping[pageName];
    if (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    }

    if (pageName === 'accounts') app.renderAccountsList();
    if (pageName === 'debts') { app.renderDebtsList(); refreshAccountSelectors(app); }
    if (pageName === 'income') { app.renderIncomeList(); app.renderBonusList(); refreshAccountSelectors(app); }
    if (pageName === 'budget') { app.renderBudgetPage(); refreshAccountSelectors(app); }
    if (pageName === 'strategy') app.renderStrategyIncomeWidget();
    if (pageName === 'reports') {
        app._reportMonthOffset = 0;
        app.renderReportsPage();
    }
    if (pageName === 'ledger') {
        renderLedgerPage(app);
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

    if (app.debts.length === 0) {
        document.getElementById('emptyState').style.display = 'block';
    } else {
        document.getElementById('emptyState').style.display = 'none';
    }

    app.renderDebtsList();
}

export function showMilestone(debtName) {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '9999';
    host.style.overflow = 'hidden';

    const toast = document.createElement('div');
    toast.textContent = `${debtName} paid off today`;
    toast.style.position = 'absolute';
    toast.style.top = '24px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.padding = '12px 18px';
    toast.style.borderRadius = '999px';
    toast.style.background = 'rgba(15, 23, 42, 0.92)';
    toast.style.color = '#fff';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.28)';
    toast.style.letterSpacing = '0.01em';
    host.appendChild(toast);

    const colors = ['#2563eb', '#059669', '#f59e0b', '#dc2626', '#7c3aed'];
    const count = 24;
    for (let index = 0; index < count; index++) {
        const piece = document.createElement('span');
        const angle = (Math.PI * 2 * index) / count;
        const distance = 120 + Math.random() * 180;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance - 40;
        piece.style.position = 'absolute';
        piece.style.left = '50%';
        piece.style.top = '18%';
        piece.style.width = `${6 + Math.random() * 6}px`;
        piece.style.height = `${10 + Math.random() * 8}px`;
        piece.style.marginLeft = `-${3 + Math.random() * 3}px`;
        piece.style.background = colors[index % colors.length];
        piece.style.borderRadius = '2px';
        piece.style.opacity = '0.95';
        piece.style.transform = 'translate(-50%, -50%)';
        host.appendChild(piece);

        const animation = piece.animate([
            { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
            { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${360 + index * 18}deg)`, opacity: 0 }
        ], {
            duration: 1100 + Math.random() * 500,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'forwards'
        });
        animation.onfinish = () => piece.remove();
    }

    document.body.appendChild(host);
    window.setTimeout(() => {
        host.remove();
    }, 1800);
}
