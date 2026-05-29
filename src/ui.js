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
            const confirmed = confirm('Clear all accounts, debts, incomes, bonuses, bills, expenses, and plan results?');
            if (confirmed) {
                app.clearAllData();
            }
        });
    }

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => app.exportToCSV());
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
