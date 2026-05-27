/**
 * app.js — Debt Tracker Application
 *
 * Main UI controller and data manager for the Debt Tracker web app.
 *
 * Debt types supported:
 *   - creditCard  : Interest-bearing debt. Uses daily-compounded interest.
 *                   Fields: accountBalance, interestRate, minimumPayment, dueDate,
 *                           originalBalance, debtStartDate (optional), priority (optional)
 *   - fixedAmount : Date-range obligation (e.g. daycare). No interest, fixed monthly cost.
 *                   Fields: fixedAmount, fixedStartDate, fixedEndDate
 *
 * Key features:
 *   - Add, inline-edit, and delete debts
 *   - Four payment strategies: Avalanche, Snowball, Priority-Low, Priority-High
 *   - Monthly payment + optional per-month stimulus/bonus payments
 *   - Target payoff date back-calculator (binary search)
 *   - Interest saved strategy comparison (all 4 strategies side-by-side)
 *   - What-if simulator (extra-payment slider, live recalc)
 *   - Minimum payment / negative-amortization risk warnings
 *   - Update-balance modal — adjust current balance without losing original
 *   - Interest paid to date — estimated real interest spent since debt was opened
 *   - Per-debt payoff progress bars (debt cards + summary table)
 *   - Calendar view (paginated, one month per page, today highlighted)
 *   - Chart view: per-debt balance timeline, cumulative payment line chart, pie chart
 *   - LocalStorage persistence (debts, strategy, monthly payment, stimulus)
 *   - CSV export of full payment plan and debt summary
 *   - Dark mode toggle, category filter, column sorting
 *
 * Dependencies:
 *   - debtCalculator.js  (DebtCalculator static class)
 *   - Chart.js           (loaded from CDN in index.html)
 */

class DebtTrackerApp {
    /**
     * Root application class.
     * Instantiated once (as `app`) after DOMContentLoaded.
     * Owns all state: debt list, last calculated plan, per-month stimulus, edit state.
     */
    constructor() {
        this.debts = [];              // Array of debt objects (see addDebt for shape)
        this.accounts = [];           // Array of account objects { id, name, type, startingBalance }
        this.incomes = [];            // Array of income source objects
        this.bonuses = [];            // Array of one-time bonus/windfall objects { id, name, amount, date, category }
        this.bills = [];              // Array of bill objects { id, name, amount, dueDay, category }
        this.expenses = [];           // Array of expense budget objects { id, name, budgetAmount, category }
        this.lastPaymentPlan = null;  // Most recently calculated paymentPlan array
        this.lastSummary = null;      // Summary object from DebtCalculator.generateSummary
        this.perMonthStimulus = [];   // Extra payment amounts indexed by plan month (0-based)
        this.editingDebtId = null;    // ID of the debt currently in inline-edit mode, or null
        this.editingIncomeId = null;  // ID of the income source currently in inline-edit mode, or null
        this.editingAccountId = null; // ID of the account currently in inline-edit mode, or null
        this._reportMonthOffset = 0;  // 0 = current month, 1 = next month, -1 = last month, etc.
        this.storageKey = 'debtTrackerData';
        
        this.initializeEventListeners();
        this.loadFromStorage();
        this.updateUI();
        this.updateFormVisibility();
        this.switchPage('accounts'); // default landing page on initial load
    }

    /**
     * Attach all DOM event listeners.
     * Called once from the constructor. Covers: tab switching, category filter,
     * dark mode, help icons, form validation, debt type toggling, calculate button,
     * localStorage change listeners, clear data, page navigation,
     * target-date panel toggle, and target-date calculate button.
     */
    initializeEventListeners() {
        // Tab switching within the Results section (Tabular / Calendar / Chart)
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = btn.getAttribute('data-tab');
                if (tab) {
                    this.switchTab(tab);
                }
            });
        });
        // Category filter on the Debts page — re-renders list on change
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.renderDebtsList();
            });
        }
        // Dark mode toggle — switches body class and updates button icon/label
        const themeSwitcher = document.getElementById('themeSwitcher');
        if (themeSwitcher) {
            themeSwitcher.addEventListener('click', () => {
                document.body.classList.toggle('dark-mode');
                themeSwitcher.textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
                themeSwitcher.setAttribute('aria-label', document.body.classList.contains('dark-mode') ? 'Toggle light mode' : 'Toggle dark mode');
            });
        }

        // Allow keyboard activation (Enter / Space) of help tooltip icons
        document.querySelectorAll('.help-icon').forEach(icon => {
            icon.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    icon.click();
                }
            });
        });

        // Live validation as the user types in the Add Debt form
        const debtForm = document.getElementById('debtForm');
        if (debtForm) {
            debtForm.addEventListener('input', (e) => {
                this.validateDebtForm();
            });
            // On submit: validate, then either save an edit or add a new debt
            debtForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!this.validateDebtForm()) return;
                if (this.editingDebtId) {
                    this.saveEdit();
                } else {
                    this.addDebt();
                }
            });
        }

        // Show/hide credit-card vs fixed-amount fields when debt type changes
        const debtTypeSelect = document.getElementById('debtType');
        if (debtTypeSelect) {
            debtTypeSelect.addEventListener('change', () => {
                this.updateFormVisibility();
            });
        }

        // "Calculate Payment Plan" button — runs the main payoff calculation
        const calculateBtn = document.getElementById('calculateBtn');
        if (calculateBtn) {
            calculateBtn.addEventListener('click', () => {
                this.calculatePaymentPlan();
            });
        }

        // Persist strategy settings immediately when the user changes them
        const monthlyPaymentEl = document.getElementById('monthlyPayment');
        if (monthlyPaymentEl) {
            monthlyPaymentEl.addEventListener('change', () => {
                this.saveToStorage();
                this.renderStrategyIncomeWidget();
            });
        }
        const paymentStrategyEl = document.getElementById('paymentStrategy');
        if (paymentStrategyEl) {
            paymentStrategyEl.addEventListener('change', () => this.saveToStorage());
        }

        // Clear All Data button
        const clearDataBtn = document.getElementById('clearDataBtn');
        if (clearDataBtn) {
            clearDataBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all debt data?')) {
                    this.clearAllData();
                }
            });
        }

        // Export full backup as JSON (header toolbar)
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => this.exportAllJSON());
        }

        // Import full backup from JSON — button triggers hidden file input (header toolbar)
        const importJsonBtn = document.getElementById('importJsonBtn');
        const importJsonInput = document.getElementById('importJsonInput');
        if (importJsonBtn && importJsonInput) {
            importJsonBtn.addEventListener('click', () => importJsonInput.click());
            importJsonInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.importAllJSON(file);
                    importJsonInput.value = '';
                }
            });
        }

        // Top nav page buttons (Debts / Income / Budget / Strategy / Results)
        document.querySelectorAll('.page-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = btn.getAttribute('data-page');
                if (page) {
                    this.switchPage(page);
                }
            });
        });

        // Bill form submit
        const billForm = document.getElementById('billForm');
        if (billForm) {
            billForm.addEventListener('submit', (e) => { e.preventDefault(); this.addBill(); });
        }

        // Expense form submit
        const expenseForm = document.getElementById('expenseForm');
        if (expenseForm) {
            expenseForm.addEventListener('submit', (e) => { e.preventDefault(); this.addExpense(); });
        }

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

        // Target payoff date: "Calculate" button runs binary-search back-calculator
        const calcTargetBtn = document.getElementById('calcTargetBtn');
        if (calcTargetBtn) {
            calcTargetBtn.addEventListener('click', () => this.calculateRequiredPayment());
        }

        // Income form submission
        const incomeForm = document.getElementById('incomeForm');
        if (incomeForm) {
            incomeForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addIncome();
            });
        }
    }

    /**
     * Validate the Add Debt form fields based on the currently selected debt type.
     * Adds/removes `.input-error` class and shows inline error messages.
     * @returns {boolean} true if all visible required fields are valid
     */
    validateDebtForm() {
        const debtType = document.getElementById('debtType').value;
        const debtNameEl = document.getElementById('debtName');
        
        // Always validate debt name
        let fields = [{ id: 'debtName', required: true }];
        
        if (debtType === 'creditCard') {
            fields = fields.concat([
                { id: 'accountBalance', required: true, min: 0 },
                { id: 'interestRate', required: true, min: 0, max: 100 },
                { id: 'minimumPayment', required: true, min: 0 },
                { id: 'dueDate', required: true, min: 1, max: 31 }
            ]);
        } else if (debtType === 'fixedAmount') {
            fields = fields.concat([
                { id: 'fixedAmount', required: true, min: 0 },
                { id: 'fixedStartDate', required: true },
                { id: 'fixedEndDate', required: true }
            ]);
        }
        
        let valid = true;
        fields.forEach(field => {
            const el = document.getElementById(field.id);
            if (!el || el.style.display === 'none') return;
            
            let error = '';
            const value = el.value;
            
            if (field.required && !value) error = 'Required';
            if (field.min !== undefined && value && Number(value) < field.min) error = `Must be ≥ ${field.min}`;
            if (field.max !== undefined && value && Number(value) > field.max) error = `Must be ≤ ${field.max}`;
            
            // Date range validation for fixed amount
            if (field.id === 'fixedEndDate' && value) {
                const startDate = document.getElementById('fixedStartDate').value;
                if (startDate && new Date(startDate) >= new Date(value)) {
                    error = 'End date must be after start date';
                }
            }
            
            let msgEl = el.nextElementSibling && el.nextElementSibling.classList.contains('error-message') ? el.nextElementSibling : null;
            if (!msgEl) {
                msgEl = document.createElement('span');
                msgEl.className = 'error-message';
                el.parentNode.insertBefore(msgEl, el.nextSibling);
            }
            if (error) {
                el.classList.add('input-error');
                msgEl.textContent = error;
                msgEl.style.display = 'block';
                valid = false;
            } else {
                el.classList.remove('input-error');
                msgEl.textContent = '';
                msgEl.style.display = 'none';
            }
        });
        return valid;
    }

    /**
     * Show/hide form fields based on the selected debt type.
     * creditCard  → shows balance, rate, min payment, due date, priority, start date fields
     * fixedAmount → hides those; shows fixed amount, start date, end date fields
     */
    updateFormVisibility() {
        const debtType = document.getElementById('debtType').value;
        const creditCardFields = document.querySelectorAll('.credit-card-field');
        const fixedAmountFields = document.querySelectorAll('.fixed-amount-field');
        const fixedAmountFieldsContainer = document.getElementById('fixedAmountFieldsContainer');
        const fixedEndDateContainer = document.getElementById('fixedEndDateContainer');

        if (debtType === 'creditCard') {
            creditCardFields.forEach(field => {
                field.style.display = '';
                field.required = true;
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

    /**
     * Read the Add Debt form, validate it, build a debt object, push it to this.debts,
     * persist to localStorage, and refresh the UI. Resets the form on success.
     *
     * Debt object shape (creditCard):
     *   { id, name, debtType, category, accountBalance, originalBalance, interestRate,
     *     priority, minimumPayment, dueDate, debtStartDate }
     *
     * Debt object shape (fixedAmount):
     *   { id, name, debtType, category, fixedAmount, fixedStartDate, fixedEndDate,
     *     accountBalance:0, interestRate:0, minimumPayment, dueDate }
     */
    addDebt() {
        const name = document.getElementById('debtName').value.trim();
        const debtType = document.getElementById('debtType').value;
        const category = document.getElementById('debtCategory') ? document.getElementById('debtCategory').value.trim() : '';

        if (!name) {
            alert('Please enter a debt name');
            return;
        }

        const debt = {
            id: Date.now(),
            name,
            debtType,
            category
        };

        if (debtType === 'creditCard') {
            const accountBalance = parseFloat(document.getElementById('accountBalance').value);
            const interestRate = parseFloat(document.getElementById('interestRate').value);
            const priority = document.getElementById('priority').value ? 
                parseInt(document.getElementById('priority').value) : null;
            const minimumPayment = parseFloat(document.getElementById('minimumPayment').value);
            const dueDate = parseInt(document.getElementById('dueDate').value);

            if (isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
                alert('Please fill in all required fields for credit card debt');
                return;
            }

            if (accountBalance < 0 || interestRate < 0 || minimumPayment < 0) {
                alert('Balance, interest rate, and minimum payment cannot be negative');
                return;
            }

            if (dueDate < 1 || dueDate > 31) {
                alert('Due date must be between 1 and 31');
                return;
            }

            debt.accountBalance = accountBalance;
            debt.originalBalance = accountBalance; // preserved for progress tracking
            debt.interestRate = interestRate;
            debt.priority = priority;
            debt.minimumPayment = minimumPayment;
            debt.dueDate = dueDate;
            debt.debtStartDate = document.getElementById('debtStartDate').value || null;
            debt.accountId = parseInt(document.getElementById('debtAccount')?.value) || null;
        } else if (debtType === 'fixedAmount') {
            const fixedAmount = parseFloat(document.getElementById('fixedAmount').value);
            const fixedStartDate = document.getElementById('fixedStartDate').value;
            const fixedEndDate = document.getElementById('fixedEndDate').value;

            if (isNaN(fixedAmount) || !fixedStartDate || !fixedEndDate) {
                alert('Please fill in all required fields for fixed amount debt');
                return;
            }

            if (fixedAmount < 0) {
                alert('Fixed amount cannot be negative');
                return;
            }

            if (new Date(fixedStartDate) >= new Date(fixedEndDate)) {
                alert('Start date must be before end date');
                return;
            }

            debt.fixedAmount = fixedAmount;
            debt.fixedStartDate = fixedStartDate;
            debt.fixedEndDate = fixedEndDate;
            debt.accountBalance = 0; // For compatibility
            debt.interestRate = 0;
            debt.minimumPayment = fixedAmount;
            debt.dueDate = new Date(fixedStartDate).getDate(); // Use day from start date
        }

        this.debts.push(debt);
        this.saveToStorage();
        this.saveToStorage();
        this.updateUI();
        // Reset form and collapse it
        document.getElementById('debtForm').reset();
        this.updateFormVisibility();
        if (typeof window.closeDebtForm === 'function') window.closeDebtForm();
    }

    /**
     * Remove a debt by ID, persist, and refresh the UI.
     * @param {number} debtId - The debt's `id` property
     */
    deleteDebt(debtId) {
        this.debts = this.debts.filter(debt => debt.id !== debtId);
        this.saveToStorage();
        this.updateUI();
    }

    /**
     * Read the monthly payment amount and strategy from the Strategy form,
     * run DebtCalculator.calculatePaymentPlan, store the result, render the
     * Results page, and switch to it.
     */
    calculatePaymentPlan() {
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        // Use per-month stimulus array if available, otherwise empty array
        const monthlyStimulus = this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0;

        if (!monthlyPayment || isNaN(monthlyPayment) || monthlyPayment <= 0) {
            alert('Please enter a valid monthly payment amount');
            return;
        }

        try {
            const result = DebtCalculator.calculatePaymentPlan(this.debts, monthlyPayment, strategy, monthlyStimulus);
            this.lastPaymentPlan = result.paymentPlan;
            this.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
            
            this.displayPaymentPlan();
            // Show the results div and scroll to it
            this.switchPage('strategy');
            const resultsEl = document.getElementById('resultsSection');
            resultsEl.style.display = 'block';
            setTimeout(() => resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        } catch (error) {
            alert('Error calculating payment plan: ' + error.message);
        }
    }

    /**
     * Use binary search to find the minimum monthly payment needed to pay off all
     * interest-bearing debts by the user's chosen target date.
     *
     * Algorithm:
     *   1. Convert target date → targetMonths from today
     *   2. Binary search (60 iterations) between totalMinimum and 2×totalBalance
     *   3. Round result up to the nearest dollar
     *   4. Render a result card with payoff stats and an optional "Use this amount" button
     */
    calculateRequiredPayment() {
        const resultEl = document.getElementById('targetPayoffResult');
        const dateVal = document.getElementById('targetPayoffDate').value;
        const strategy = document.getElementById('targetPayoffStrategy').value;

        if (!dateVal) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Please enter a target date.</div></div>`;
            return;
        }

        const targetDate = new Date(dateVal + 'T12:00:00');
        const today = new Date();
        if (targetDate <= today) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Target date must be in the future.</div></div>`;
            return;
        }

        if (this.debts.filter(d => d.debtType !== 'fixedAmount').length === 0) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">No interest-bearing debts to calculate for.</div></div>`;
            return;
        }

        // How many months until target date?
        const targetMonths = (targetDate.getFullYear() - today.getFullYear()) * 12
            + (targetDate.getMonth() - today.getMonth());

        if (targetMonths < 1) {
            resultEl.innerHTML = `<div class="target-result target-result--error"><div class="target-result-headline">Target date must be at least one month away.</div></div>`;
            return;
        }

        // Minimum required payment (sum of minimums)
        const totalMinimum = this.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);

        // Binary search: find the smallest payment that pays off all debts within targetMonths
        let lo = totalMinimum;
        let hi = this.debts.reduce((s, d) => s + (d.accountBalance || 0), 0) * 2 + 10000;
        let found = null;

        for (let iter = 0; iter < 60; iter++) {
            const mid = (lo + hi) / 2;
            try {
                const r = DebtCalculator.calculatePaymentPlan(this.debts, mid, strategy, 0);
                if (r.paymentPlan.length <= targetMonths) {
                    found = mid;
                    hi = mid;
                } else {
                    lo = mid;
                }
            } catch(e) {
                lo = mid;
            }
        }

        if (!found) {
            resultEl.innerHTML = `<div class="target-result target-result--error">
                <div class="target-result-headline">❌ Unable to calculate</div>
                <p style="margin:0;font-size:0.88rem;">This target date may be unreachable. Try a later date.</p>
            </div>`;
            return;
        }

        // Round up to nearest dollar for a clean "safe" number
        const requiredPayment = Math.ceil(found);

        // Run once more at the clean number to get summary stats
        let summary, actualMonths;
        try {
            const r = DebtCalculator.calculatePaymentPlan(this.debts, requiredPayment, strategy, 0);
            summary = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
            actualMonths = r.paymentPlan.length;
        } catch(e) {
            summary = null;
            actualMonths = targetMonths;
        }

        const currentPayment = parseFloat(document.getElementById('monthlyPayment').value) || 0;
        const extraNeeded = requiredPayment - currentPayment;
        const isHigher = requiredPayment > currentPayment + 0.5;
        const panelClass = isHigher ? 'target-result--warn' : 'target-result';
        const headline = isHigher
            ? `⚠️ You need to pay ${this.formatCurrency(extraNeeded)} more/month`
            : `✅ Your current payment covers this goal`;

        const payoffDateStr = summary ? DebtCalculator.formatDate(summary.payOffDate) : dateVal;
        const interestStr = summary ? this.formatCurrency(summary.totalInterest) : '—';

        resultEl.innerHTML = `<div class="target-result ${panelClass}">
            <div class="target-result-headline">${headline}</div>
            <span class="target-result-payment">${this.formatCurrency(requiredPayment)}<span style="font-size:0.5em;font-weight:500;"> / month</span></span>
            <div class="target-result-meta">
                <span>📅 Payoff by <strong>${payoffDateStr}</strong></span>
                <span>⏱ ${actualMonths} month${actualMonths !== 1 ? 's' : ''}</span>
                <span>💸 Total interest: <strong>${interestStr}</strong></span>
            </div>
            ${isHigher ? `<div class="target-result-action">
                <button class="btn btn-primary btn-small" id="applyTargetPayment">Use this amount ↗</button>
            </div>` : ''}
        </div>`;

        if (isHigher) {
            document.getElementById('applyTargetPayment').addEventListener('click', () => {
                document.getElementById('monthlyPayment').value = requiredPayment;
                document.getElementById('paymentStrategy').value = strategy;
                this.saveToStorage();
                // Scroll to calculate button
                document.getElementById('calculateBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
                document.getElementById('calculateBtn').focus();
            });
        }
    }

    /**
     * Render the full Results page after a calculation:
     *   - Summary stats (total debt, interest, payoff time, monthly interest cost)
     *   - Debt Summary table
     *   - Strategy interest comparison panel
     *   - What-if extra-payment simulator
     *   - Monthly payment schedule table
     */
    displayPaymentPlan() {
        if (!this.lastPaymentPlan || !this.lastSummary) return;

        // Update summary
        document.getElementById('totalDebtValue').textContent = 
            this.formatCurrency(this.lastSummary.totalDebt);
        document.getElementById('totalInterestValue').textContent = 
            this.formatCurrency(this.lastSummary.totalInterest);
        document.getElementById('timeToPayOffValue').textContent = 
            `${this.lastSummary.monthsToPayOff} months (${DebtCalculator.formatDate(this.lastSummary.payOffDate)})`;

        // Monthly interest cost: sum of all interest charges in month 1
        let monthlyInterestCost = 0;
        if (this.lastPaymentPlan.length > 0) {
            for (const payment of this.lastPaymentPlan[0].payments) {
                monthlyInterestCost += payment.interest || 0;
            }
        }
        const micEl = document.getElementById('monthlyInterestCostValue');
        if (micEl) micEl.textContent = this.formatCurrency(monthlyInterestCost);

        // Build debt summary table
        this.displayDebtSummary();

        // Strategy comparison + what-if simulator
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
        const strategy = document.getElementById('paymentStrategy').value;
        this.displayInterestComparison(strategy, monthlyPayment);
        this.displayWhatIfSimulator(monthlyPayment, strategy);

        // Build payment schedule table
        this.displayPaymentSchedule();
    }

    /**
     * Build this._debtSummaryRows from this.lastPaymentPlan, then call
     * _renderDebtSummaryTable(). Also wires up column-header sort clicks.
     *
     * Each row includes: name, minDue, interestRate, dueDate, isFixedAmount,
     * totalPaid, principalPaid, interestPaid, payoffDate, interestToDate,
     * debtStartDate, order.
     */
    displayDebtSummary() {
        // Get debt names in the order they appear in the payment plan (payment priority order)
        const debtOrderMap = {};
        const debtSummaryMap = {};
        let orderIndex = 0;

        // Map debtName to original debt object for min due and interest rate
        const originalDebts = {};
        for (const debt of this.debts) {
            originalDebts[debt.name] = debt;
        }

        for (const monthData of this.lastPaymentPlan) {
            for (const payment of monthData.payments) {
                if (!debtSummaryMap[payment.debtName]) {
                    debtOrderMap[payment.debtName] = orderIndex++;
                    const orig = originalDebts[payment.debtName] || {};
                    debtSummaryMap[payment.debtName] = {
                        minDue: orig.minimumPayment || 0,
                        interestRate: orig.interestRate || 0,
                        dueDate: orig.dueDate || null,
                        isFixedAmount: orig.debtType === 'fixedAmount',
                        totalPaid: 0,
                        principalPaid: 0,
                        interestPaid: 0,
                        payoffDate: null,
                        lastPaymentDate: null
                    };
                }

                debtSummaryMap[payment.debtName].totalPaid += payment.payment;
                debtSummaryMap[payment.debtName].principalPaid += payment.principal;
                debtSummaryMap[payment.debtName].interestPaid += payment.interest;

                // Build a date using the debt's due day if available, else the 1st of the month
                const summaryEntry = debtSummaryMap[payment.debtName];
                const dueDay = summaryEntry.dueDate;
                const payoffDateWithDueDay = (date) => {
                    if (dueDay) {
                        const d = new Date(date.getFullYear(), date.getMonth(), dueDay);
                        return DebtCalculator.formatDate(d);
                    }
                    return DebtCalculator.formatDate(date);
                };

                // Track last payment date for fixed-amount debts (used as completion date)
                if (summaryEntry.isFixedAmount) {
                    summaryEntry.lastPaymentDate = payoffDateWithDueDay(monthData.date);
                }

                if (payment.paidOff) {
                    summaryEntry.payoffDate = payoffDateWithDueDay(monthData.date);
                }
            }
        }

        // Store rows as array for sorting: [name, summaryObj, orderIndex]
        this._debtSummaryRows = Object.entries(debtSummaryMap).map(([name, summary]) => {
            const origDebt = originalDebts[name] || {};
            const iptd = this.computeInterestPaidToDate(origDebt);
            return {
                name,
                ...summary,
                payoffDate: summary.isFixedAmount ? (summary.lastPaymentDate || null) : summary.payoffDate,
                interestToDate: iptd ? iptd.interestPaid : null,
                debtStartDate: origDebt.debtStartDate || null,
                order: debtOrderMap[name]
            };
        });
        this._debtSummarySort = this._debtSummarySort || { col: 'order', dir: 1 };

        this._renderDebtSummaryTable();

        // Wire up column header sort clicks (once)
        const table = document.getElementById('debtSummaryTable');
        table.querySelectorAll('th[data-sort]').forEach(th => {
            th.onclick = () => {
                const col = th.getAttribute('data-sort');
                if (this._debtSummarySort.col === col) {
                    this._debtSummarySort.dir *= -1;
                } else {
                    this._debtSummarySort.col = col;
                    this._debtSummarySort.dir = 1;
                }
                this._renderDebtSummaryTable();
            };
        });
    }

    /**
     * Re-sort and re-render the debt summary table body using this._debtSummaryRows
     * and this._debtSummarySort. Also updates column header sort icons.
     * Called by displayDebtSummary() and whenever a sort header is clicked.
     */
    _renderDebtSummaryTable() {
        const summaryBody = document.getElementById('debtSummaryTableBody');
        summaryBody.innerHTML = '';

        const { col, dir } = this._debtSummarySort;

        // Update header sort icons
        document.querySelectorAll('#debtSummaryTable th[data-sort]').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            if (!icon) return;
            if (th.getAttribute('data-sort') === col) {
                icon.textContent = dir === 1 ? '↑' : '↓';
                th.classList.add('sort-active');
            } else {
                icon.textContent = '↕';
                th.classList.remove('sort-active');
            }
        });

        const rows = [...this._debtSummaryRows].sort((a, b) => {
            let aVal = a[col];
            let bVal = b[col];
            // Treat dates as comparable strings (ISO-like format should sort correctly), nulls last
            if (col === 'payoffDate' || col === 'interestToDate') {
                if (!aVal && !bVal) return 0;
                if (!aVal) return 1;
                if (!bVal) return -1;
                if (col === 'payoffDate') return aVal.localeCompare(bVal) * dir;
                return (aVal - bVal) * dir;
            }
            if (col === 'name') return aVal.localeCompare(bVal) * dir;
            return (aVal - bVal) * dir;
        });

        for (const summary of rows) {
            const dueDateStr = summary.dueDate
                ? `<div style="font-size:0.78em;color:#6b7280;margin-top:2px;">Due: ${this.getDayOrdinal(summary.dueDate)} of month</div>`
                : '';

            // Progress bar: based on originalBalance vs current accountBalance
            const origDebt = this.debts.find(d => d.name === summary.name);
            let progressPct = 0;
            if (summary.isFixedAmount && origDebt) {
                const start = new Date(origDebt.fixedStartDate);
                const end = new Date(origDebt.fixedEndDate);
                const now = new Date();
                const total = end - start;
                const elapsed = Math.max(0, Math.min(now - start, total));
                progressPct = total > 0 ? Math.round(elapsed / total * 100) : 0;
            } else if (origDebt) {
                const origBal = origDebt.originalBalance || origDebt.accountBalance || 0;
                const currBal = origDebt.accountBalance || 0;
                progressPct = origBal > 0 ? Math.min(100, Math.round((origBal - currBal) / origBal * 100)) : 0;
            }
            const progressBar = `
                <div class="summary-progress-wrap">
                    <div class="summary-progress-bar">
                        <div class="summary-progress-fill${progressPct >= 100 ? ' summary-progress-fill--complete' : ''}" style="width:${progressPct}%"></div>
                    </div>
                    <div class="summary-progress-label">${progressPct}% paid off</div>
                </div>`;

            const row = document.createElement('tr');
            const iptdCell = summary.interestToDate !== null
                ? `<span class="iptd-value">${this.formatCurrency(summary.interestToDate)}</span>
                   ${summary.debtStartDate ? `<div class="iptd-sub">since ${new Date(summary.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>` : ''}`
                : '<span style="color:#9ca3af;font-size:0.8em;">No start date</span>';
            row.innerHTML = `
                <td>${summary.name}${dueDateStr}${progressBar}</td>
                <td class="min-due">${this.formatCurrency(summary.minDue)}</td>
                <td class="interest-rate">${summary.interestRate.toFixed(2)}%</td>
                <td class="amount">${this.formatCurrency(summary.totalPaid)}</td>
                <td class="principal">${this.formatCurrency(summary.principalPaid)}</td>
                <td class="interest">${this.formatCurrency(summary.interestPaid)}</td>
                <td>${iptdCell}</td>
                <td>${summary.payoffDate || '-'}</td>
                <td><button class="btn btn-small btn-secondary" data-amortization="${summary.name}">View</button></td>
            `;
            summaryBody.appendChild(row);
            // Milestone: show confetti if debt was just paid off this render
            if (summary.payoffDate) {
                const today = new Date();
                const payoff = new Date(summary.payoffDate);
                if (
                    payoff.getFullYear() === today.getFullYear() &&
                    payoff.getMonth() === today.getMonth() &&
                    payoff.getDate() === today.getDate()
                ) {
                    this.showMilestone(summary.name);
                }
            }
        }

        // Add event listeners for amortization buttons
        document.querySelectorAll('[data-amortization]').forEach(btn => {
            btn.addEventListener('click', () => {
                const debtName = btn.getAttribute('data-amortization');
                this.showAmortizationModal(debtName);
            });
        });
    }

    /**
     * Open the amortization modal for a single debt, showing a month-by-month
     * table of payment, principal, interest, and remaining balance.
     * @param {string} debtName - Debt name as it appears in the payment plan
     */
    showAmortizationModal(debtName) {
        const modal = document.getElementById('amortizationModal');
        const title = document.getElementById('amortizationTitle');
        const wrapper = document.getElementById('amortizationTableWrapper');
        if (!modal || !title || !wrapper) return;
        title.textContent = `Amortization Schedule: ${debtName}`;
        // Build amortization table for this debt
        let html = '<div class="table-wrapper"><table style="min-width:600px"><thead><tr><th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>';
        if (this.lastPaymentPlan) {
            for (let mi = 0; mi < this.lastPaymentPlan.length; mi++) {
                const monthData = this.lastPaymentPlan[mi];
                const payment = monthData.payments.find(p => p.debtName === debtName);
                if (payment) {
                    html += `<tr><td>${DebtCalculator.getMonthName(monthData.month - 1)}</td><td>${this.formatCurrency(payment.payment)}</td><td>${this.formatCurrency(payment.principal)}</td><td>${this.formatCurrency(payment.interest)}</td><td>${this.formatCurrency(payment.balance)}</td></tr>`;
                }
            }
        }
        html += '</tbody></table></div>';
        wrapper.innerHTML = html;
        modal.style.display = 'flex';
        // Close button
        document.getElementById('closeAmortization').onclick = () => {
            modal.style.display = 'none';
        };
        // Close on outside click
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    }

    /**
     * Build the monthly payment schedule table (tabular view tab).
     * Columns: Month | [one column per debt] | Stimulus ($) | Total Paid
     *
     * The Stimulus column is an editable number input per month. Changing it
     * updates this.perMonthStimulus, persists, and immediately recalculates the plan.
     */
    displayPaymentSchedule() {
        if (!this.lastPaymentPlan || this.lastPaymentPlan.length === 0) return;

        // Get unique debt names from the payment plan
        const debtNames = [];
        const debtNameSet = new Set();
        for (const monthData of this.lastPaymentPlan) {
            for (const payment of monthData.payments) {
                if (!debtNameSet.has(payment.debtName)) {
                    debtNames.push(payment.debtName);
                    debtNameSet.add(payment.debtName);
                }
            }
        }

        // Sort columns by payoff order: the debt whose last non-zero payment appears
        // earliest in the plan is the first to be paid off → leftmost column.
        const lastPaymentMonthIndex = {};
        for (const name of debtNames) lastPaymentMonthIndex[name] = -1;
        for (let mi = 0; mi < this.lastPaymentPlan.length; mi++) {
            for (const payment of this.lastPaymentPlan[mi].payments) {
                if (payment.payment > 0) {
                    lastPaymentMonthIndex[payment.debtName] = mi;
                }
            }
        }
        debtNames.sort((a, b) => lastPaymentMonthIndex[a] - lastPaymentMonthIndex[b]);

        // Build header with Month + all debt names (sorted) + Stimulus (editable) + Total Paid
        const thead = document.getElementById('paymentTableHead');
        thead.innerHTML = '';
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th>Month</th>';
        for (const debtName of debtNames) {
            headerRow.innerHTML += `<th>${debtName}</th>`;
        }
        headerRow.innerHTML += '<th>Stimulus ($)</th>';
        headerRow.innerHTML += '<th>Total Paid</th>';

        // Build a map of debt name -> dueDate day for use in row rendering
        const debtDueDateMap = {};
        for (const debt of this.debts) {
            debtDueDateMap[debt.name] = debt.dueDate || null;
        }
        thead.appendChild(headerRow);

        // Build body with one row per month
        const tableBody = document.getElementById('paymentTableBody');
        tableBody.innerHTML = '';

        // Ensure perMonthStimulus array is at least as long as the plan
        if (!this.perMonthStimulus) this.perMonthStimulus = [];

        for (let mi = 0; mi < this.lastPaymentPlan.length; mi++) {
            const monthData = this.lastPaymentPlan[mi];
            // Get month name using the calculator's method
            const monthName = DebtCalculator.getMonthName(monthData.month - 1);

            // Create a map of debt payments for this month and calculate overages
            const monthPaymentMap = {};
            const monthOverageMap = {};
            let monthTotal = 0;
            let monthTotalOverage = 0;
            let monthStimulusTotal = 0;

            for (const payment of monthData.payments) {
                monthPaymentMap[payment.debtName] = payment.payment;

                // Find the original debt to get minimum payment
                const originalDebt = this.debts.find(d => d.name === payment.debtName);
                const minimumPayment = originalDebt ? originalDebt.minimumPayment : 0;
                const overage = Math.max(0, payment.payment - minimumPayment);

                monthOverageMap[payment.debtName] = overage;
                monthTotal += payment.payment;
                monthTotalOverage += overage;
            }

            // Calculate total stimulus applied this month
            if (monthData.stimulusApplied) {
                for (const debtName of debtNames) {
                    monthStimulusTotal += monthData.stimulusApplied[debtName] || 0;
                }
            }

            // Determine editable stimulus value for this month (either user-provided or the applied total)
            const editableStimulusVal = this.perMonthStimulus[mi] !== undefined ? this.perMonthStimulus[mi] : monthStimulusTotal;

            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${monthName}</strong></td>`;

            for (const debtName of debtNames) {
                const payment = monthPaymentMap[debtName] || 0;
                const overage = monthOverageMap[debtName] || 0;
                let paymentStr = '-';
                if (payment > 0) {
                    paymentStr = this.formatCurrency(payment);
                    if (overage > 0) {
                        paymentStr += `<br><small>(+${this.formatCurrency(overage)})</small>`;
                    }
                    // Show stimulus applied to this debt if any
                    if (monthData.stimulusApplied && monthData.stimulusApplied[debtName]) {
                        paymentStr += `<br><span style='color:#059669;font-size:0.9em;'>(Stimulus: ${this.formatCurrency(monthData.stimulusApplied[debtName])})</span>`;
                    }
                }
                row.innerHTML += `<td class="amount">${paymentStr}</td>`;
            }

            // Add editable stimulus input column
            const stimulusInputId = `stimulus-input-${mi}`;
            // Safely format editableStimulusVal (may be null/undefined)
            const stimDisplayNumber = Number(editableStimulusVal);
            const stimDisplayStr = !isFinite(stimDisplayNumber) ? '0.00' : stimDisplayNumber.toFixed(2);
            const stimulusDisplay = `<input id="${stimulusInputId}" type="number" step="0.01" min="0" value="${stimDisplayStr}" style="width:100px;">`;
            row.innerHTML += `<td class="amount" style="color:#059669;font-weight:600;">${stimulusDisplay}</td>`;

            // Add total paid column with overage
            let totalPaidStr = this.formatCurrency(monthTotal);
            if (monthTotalOverage > 0) {
                totalPaidStr += `<br><small>(+${this.formatCurrency(monthTotalOverage)})</small>`;
            }
            row.innerHTML += `<td class="amount" style="font-weight: bold; border-left: 2px solid var(--border-color);">${totalPaidStr}</td>`;

            tableBody.appendChild(row);

            // Attach input handler for per-month stimulus changes
            const stimInput = document.getElementById(`stimulus-input-${mi}`);
            if (stimInput) {
                stimInput.addEventListener('change', (e) => {
                    const v = parseFloat(e.target.value);
                    this.perMonthStimulus[mi] = isNaN(v) ? 0 : v;
                    // Save stimulus to storage along with debts
                    this.saveToStorage();
                    // Recalculate with updated per-month stimulus array
                    try {
                        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
                        const strategy = document.getElementById('paymentStrategy').value;
                        if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                            const result = DebtCalculator.calculatePaymentPlan(this.debts, monthlyPayment, strategy, this.perMonthStimulus);
                            this.lastPaymentPlan = result.paymentPlan;
                            this.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                            this.displayPaymentPlan();
                        }
                    } catch (err) {
                        console.error('Error recalculating after stimulus change', err);
                    }
                });
            }
        }
    }

    /**
     * Export the current payment plan to a downloadable CSV file.
     * The file contains two sections:
     *   1. Monthly schedule — one row per month with per-debt payment amounts,
     *      a "Stimulus Applied" column, and a monthly total.
     *   2. Debt summary — one row per debt with totals for principal, interest
     *      paid, and estimated payoff date.
     */
    exportToCSV() {
        if (!this.lastPaymentPlan) {
            alert('Please calculate a payment plan first');
            return;
        }

        // Get unique debt names in the order they appear in the payment plan (payment priority order)
        const debtNames = [];
        const debtNameSet = new Set();
        for (const monthData of this.lastPaymentPlan) {
            for (const payment of monthData.payments) {
                if (!debtNameSet.has(payment.debtName)) {
                    debtNames.push(payment.debtName);
                    debtNameSet.add(payment.debtName);
                }
            }
        }

    // Header row (include Stimulus Applied column)
    let csv = 'Month,' + debtNames.join(',') + ',Stimulus Applied,Total Paid\n';

        // Data rows
        for (const monthData of this.lastPaymentPlan) {
            // Get month name using the calculator's method
            const monthName = DebtCalculator.getMonthName(monthData.month - 1);

            // Create a map of debt payments for this month and total stimulus
            const monthPaymentMap = {};
            for (const payment of monthData.payments) {
                monthPaymentMap[payment.debtName] = payment.payment;
            }

            let monthStimulusTotal = 0;
            if (monthData.stimulusApplied) {
                for (const dn of debtNames) {
                    monthStimulusTotal += monthData.stimulusApplied[dn] || 0;
                }
            }

            csv += `"${monthName}"`;
            for (const debtName of debtNames) {
                const payment = monthPaymentMap[debtName] || 0;
                csv += `,"${payment > 0 ? payment.toFixed(2) : ''}"`;
            }
            csv += `,"${monthStimulusTotal > 0 ? monthStimulusTotal.toFixed(2) : ''}"`;
            // total paid for the month
            const monthTotal = monthData.payments.reduce((s, p) => s + (p.payment || 0), 0);
            csv += `,"${monthTotal.toFixed(2)}"`;
            csv += '\n';
        }

        // Add blank line and summary
        csv += '\n\nDebt Summary\n';
        csv += 'Debt Name,Total Amount Paid,Principal Paid,Interest Paid,Estimated Payoff Date\n';

        // Get debt names and data in payment order
        const debtOrderMap = {};
        const debtSummaryMap = {};
        let orderIndex = 0;

        const originalDebts = {};
        for (const debt of this.debts) {
            originalDebts[debt.name] = debt;
        }

        for (const monthData of this.lastPaymentPlan) {
            for (const payment of monthData.payments) {
                if (!debtSummaryMap[payment.debtName]) {
                    debtOrderMap[payment.debtName] = orderIndex++;
                    const orig = originalDebts[payment.debtName] || {};
                    debtSummaryMap[payment.debtName] = {
                        totalPaid: 0,
                        principalPaid: 0,
                        interestPaid: 0,
                        isFixedAmount: orig.debtType === 'fixedAmount',
                        payoffDate: null,
                        lastPaymentDate: null
                    };
                }

                debtSummaryMap[payment.debtName].totalPaid += payment.payment;
                debtSummaryMap[payment.debtName].principalPaid += payment.principal;
                debtSummaryMap[payment.debtName].interestPaid += payment.interest;

                if (debtSummaryMap[payment.debtName].isFixedAmount) {
                    debtSummaryMap[payment.debtName].lastPaymentDate = DebtCalculator.formatDate(monthData.date);
                }

                if (payment.paidOff) {
                    debtSummaryMap[payment.debtName].payoffDate = DebtCalculator.formatDate(monthData.date);
                }
            }
        }

        // Sort by payment order
        const sortedDebts = Object.entries(debtSummaryMap).sort((a, b) => {
            return debtOrderMap[a[0]] - debtOrderMap[b[0]];
        });

        for (const [debtName, summary] of sortedDebts) {
            const payoffDate = summary.isFixedAmount ? (summary.lastPaymentDate || '') : (summary.payoffDate || '');
            csv += `"${debtName}","${summary.totalPaid.toFixed(2)}","${summary.principalPaid.toFixed(2)}","${summary.interestPaid.toFixed(2)}","${payoffDate}"\n`;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debt-plan-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    /**
     * Refresh the entire UI to match the current state of `this.debts`.
     * - Restores saved monthly-payment and strategy values from storage.
     * - Shows the empty-state banner and redirects to the Add page when there
     *   are no debts.
     * - Otherwise hides the empty state, activates the Debts page, and calls
     *   `renderDebtsList()`.
     */
    updateUI() {
        // Restore saved strategy settings
        if (this._savedMonthlyPayment) {
            const mpEl = document.getElementById('monthlyPayment');
            if (mpEl && !mpEl.value) mpEl.value = this._savedMonthlyPayment;
        }
        if (this._savedStrategy) {
            const stratEl = document.getElementById('paymentStrategy');
            if (stratEl) stratEl.value = this._savedStrategy;
        }

        if (this.debts.length === 0) {
            document.getElementById('emptyState').style.display = 'block';
        } else {
            document.getElementById('emptyState').style.display = 'none';
        }

        // Re-render the debt list in place (preserves current page)
        this.renderDebtsList();
    }

    /**
     * Activate a top-level page section and update the nav button state.
     * @param {string} pageName - One of `'debts'`, `'income'`, `'budget'`, `'strategy'`
     */
    switchPage(pageName) {
        // update nav active state
        document.querySelectorAll('.page-button').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
        if (btn) btn.classList.add('active');

        // list of page section ids
        const mapping = {
            accounts: 'accountsSection',
            debts: 'debtsSection',
            income: 'incomeSection',
            budget: 'budgetSection',
            strategy: 'strategySection',
            reports: 'reportsSection'
        };

        // hide all sections
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

        const id = mapping[pageName];
        if (id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('active');
        }

        // Keep side-effects for specific pages
        if (pageName === 'accounts') this.renderAccountsList();
        if (pageName === 'debts') { this.renderDebtsList(); this._refreshAccountSelectors(); }
        if (pageName === 'income') { this.renderIncomeList(); this.renderBonusList(); this._refreshAccountSelectors(); }
        if (pageName === 'budget') { this.renderBudgetPage(); this._refreshAccountSelectors(); }
        if (pageName === 'strategy') this.renderStrategyIncomeWidget();
        if (pageName === 'reports') {
            this._reportMonthOffset = 0; // Reset to current month when entering Reports
            this._updateReportMonthNav();
            this.renderReportsPage();
        }
    }

    /**
     * Estimate the interest already paid on a credit-card debt since its
     * `debtStartDate` using daily compounding on the original balance.
     *
     * Algorithm:
     *   totalAccrued = origBal × ((1 + rate/365)^days − 1)
     *   interestPaid = max(0, totalAccrued − principalPaidDown)
     *
     * @param {object} debt - A debt object with `debtType`, `debtStartDate`,
     *   `originalBalance`, `accountBalance`, and `interestRate`.
     * @returns {{ interestPaid: number, days: number, start: Date } | null}
     *   Returns `null` if the debt is not a credit card, has no start date,
     *   or the start date is in the future.
     */
    computeInterestPaidToDate(debt) {
        // Only run for credit-card debts that have a start date.
        // Treat a missing/undefined debtType as 'creditCard' (backward-compat with
        // debts saved before the debtType field was introduced).
        const isCC = !debt.debtType || debt.debtType === 'creditCard';
        if (!debt.debtStartDate || !isCC) return null;

        // Use noon local time to avoid UTC-midnight date-shift issues
        const start = new Date(debt.debtStartDate + 'T12:00:00');
        const today = new Date();
        if (isNaN(start.getTime()) || start >= today) return null;

        const origBal = debt.originalBalance || debt.accountBalance;
        const dailyRate = (debt.interestRate || 0) / 100 / 365;
        const days = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        if (days <= 0) return null;

        // Total amount that would have accrued on original balance
        const totalAccrued = origBal * (Math.pow(1 + dailyRate, days) - 1);
        // Subtract actual principal paid down
        const principalPaid = Math.max(0, origBal - debt.accountBalance);
        // Interest paid = accrued interest minus any balance reduction beyond principal
        const interestPaid = Math.max(0, totalAccrued - principalPaid);
        return { interestPaid, days, start };
    }

    /**
     * Render the Debts page list.
     * Each debt is shown as a card with:
     *   - Name, balance, APR, minimum payment, due date, category
     *   - A negative-amortization warning badge if APR causes the balance to grow
     *   - A paydown progress bar (requires `originalBalance`)
     *   - Monthly interest cost estimate
     *   - Interest Paid to Date stat (credit-card debts with `debtStartDate` only)
     *   - Edit / Delete / Update Balance action buttons
     *
     * If `this.editingDebtId` is set the matching card is replaced with an
     * inline edit form instead.
     */
    renderDebtsList() {
        // Render category summary card
        const categorySummary = document.getElementById('categorySummary');
        if (categorySummary) {
            if (this.debts.length === 0) {
                categorySummary.innerHTML = '';
            } else {
                // ── Totals ──────────────────────────────────────────────────
                const totalDebt = this.debts.reduce((s, d) => {
                    return s + (d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0));
                }, 0);
                const totalMin = this.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
                const totalInterest = this.lastSummary ? this.lastSummary.totalInterest : null;

                // ── Category breakdown ───────────────────────────────────────
                const catMap = {};
                for (const d of this.debts) {
                    const cat = d.category || 'Uncategorized';
                    if (!catMap[cat]) catMap[cat] = { count: 0, total: 0, minTotal: 0 };
                    catMap[cat].count++;
                    catMap[cat].total += d.debtType === 'fixedAmount' ? (d.fixedAmount || 0) : (d.accountBalance || 0);
                    catMap[cat].minTotal += d.minimumPayment || 0;
                }

                const catRows = Object.entries(catMap)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([cat, v]) => `
                        <div class="debt-overview-cat-row">
                            <span class="debt-overview-cat-name">${cat}</span>
                            <span class="debt-overview-cat-count">${v.count} debt${v.count !== 1 ? 's' : ''}</span>
                            <span class="debt-overview-cat-min">${this.formatCurrency(v.minTotal)}/mo</span>
                            <span class="debt-overview-cat-total">${this.formatCurrency(v.total)}</span>
                        </div>`).join('');

                const interestHTML = totalInterest !== null
                    ? `<div class="debt-overview-stat">
                            <span class="debt-overview-stat-label">Total Interest (projected)</span>
                            <span class="debt-overview-stat-value debt-overview-stat-value--interest">${this.formatCurrency(totalInterest)}</span>
                        </div>`
                    : `<div class="debt-overview-stat">
                            <span class="debt-overview-stat-label">Total Interest (projected)</span>
                            <span class="debt-overview-stat-value debt-overview-stat-value--muted">Run a plan to see</span>
                        </div>`;

                categorySummary.innerHTML = `
                    <div class="debt-overview-card">
                        <div class="debt-overview-header">📊 Debt Overview</div>
                        <div class="debt-overview-stats">
                            <div class="debt-overview-stat">
                                <span class="debt-overview-stat-label">Total Overall Debt</span>
                                <span class="debt-overview-stat-value">${this.formatCurrency(totalDebt)}</span>
                            </div>
                            <div class="debt-overview-stat">
                                <span class="debt-overview-stat-label">Monthly Minimums</span>
                                <span class="debt-overview-stat-value">${this.formatCurrency(totalMin)}</span>
                            </div>
                            ${interestHTML}
                        </div>
                        <div class="debt-overview-cats">
                            <div class="debt-overview-cats-header">
                                <span>Category</span>
                                <span>Count</span>
                                <span>Min/mo</span>
                                <span>Balance</span>
                            </div>
                            ${catRows}
                        </div>
                    </div>`;
            }
        }
        const debtsList = document.getElementById('debtsList');
        debtsList.innerHTML = '';

        // Populate category filter dropdown
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            // Get unique categories from debts
            const categories = Array.from(new Set(this.debts.map(d => d.category).filter(Boolean)));
            // Save current selection
            const prevValue = categoryFilter.value;
            // Remove all except 'All'
            categoryFilter.innerHTML = '<option value="">All</option>';
            categories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                categoryFilter.appendChild(opt);
            });
            // Restore previous selection if possible
            if (categories.includes(prevValue)) {
                categoryFilter.value = prevValue;
            }
        }

        // Filter debts by selected category
        let filteredDebts = this.debts;
        if (categoryFilter && categoryFilter.value) {
            filteredDebts = this.debts.filter(d => d.category === categoryFilter.value);
        }

        for (const debt of filteredDebts) {
            const card = document.createElement('div');
            card.className = 'debt-card';
            // If this debt is being edited inline, render inputs
            if (this.editingDebtId === debt.id) {
                let editHTML = `
                    <div class="debt-info">
                        <div class="debt-name"><input id="inline-name-${debt.id}" type="text" value="${debt.name}"></div>
                        <div class="debt-details">`;
                
                if (debt.debtType === 'fixedAmount') {
                    editHTML += `
                            <div class="debt-detail"><strong>Amount:</strong> <input id="inline-fixed-amount-${debt.id}" type="number" step="0.01" value="${debt.fixedAmount}"></div>
                            <div class="debt-detail"><strong>Start Date:</strong> <input id="inline-start-date-${debt.id}" type="date" value="${debt.fixedStartDate}"></div>
                            <div class="debt-detail"><strong>End Date:</strong> <input id="inline-end-date-${debt.id}" type="date" value="${debt.fixedEndDate}"></div>
                            <div class="debt-detail"><strong>Priority:</strong> <input id="inline-priority-${debt.id}" type="number" min="1" max="100" value="${debt.priority || ''}"></div>`;
                } else {
                    editHTML += `
                            <div class="debt-detail"><strong>Balance:</strong> <input id="inline-balance-${debt.id}" type="number" step="0.01" value="${debt.accountBalance}"></div>
                            <div class="debt-detail"><strong>Interest:</strong> <input id="inline-interest-${debt.id}" type="number" step="0.01" value="${debt.interestRate}">% </div>
                            <div class="debt-detail"><strong>Min Payment:</strong> <input id="inline-min-${debt.id}" type="number" step="0.01" value="${debt.minimumPayment}"></div>
                            <div class="debt-detail"><strong>Due Date:</strong> <input id="inline-due-${debt.id}" type="number" min="1" max="31" value="${debt.dueDate}"></div>
                            <div class="debt-detail"><strong>Priority:</strong> <input id="inline-priority-${debt.id}" type="number" min="1" max="100" value="${debt.priority || ''}"></div>
                            <div class="debt-detail"><strong>Date Opened:</strong> <input id="inline-start-date-cc-${debt.id}" type="date" value="${debt.debtStartDate || ''}"></div>`;
                }
                
                editHTML += `
                            <div class="debt-detail"><strong>Category:</strong> <input id="inline-category-${debt.id}" type="text" value="${debt.category || ''}"></div>
                            <div class="debt-detail"><strong>Account:</strong>
                                <select id="inline-account-${debt.id}">
                                    <option value="">— No account —</option>
                                    ${this.accounts.map(a => `<option value="${a.id}" ${debt.accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="debt-actions">
                        <button class="btn btn-success btn-save" onclick="app.saveInlineEdit(${debt.id})">Save</button>
                        <button class="btn btn-secondary btn-cancel" onclick="app.cancelInlineEdit()">Cancel</button>
                    </div>
                `;
                card.innerHTML = editHTML;
            } else {
                let cardHTML = `
                    <div class="debt-info">
                        <div class="debt-name">${debt.name}`;
                if (debt.debtType === 'fixedAmount') {
                    cardHTML += ` <span class="debt-type-badge">Fixed Amount</span>`;
                }
                cardHTML += `</div>
                        <div class="debt-details">`;
                
                if (debt.debtType === 'fixedAmount') {
                    // Fixed amount debt: date-based progress
                    const start = new Date(debt.fixedStartDate);
                    const end = new Date(debt.fixedEndDate);
                    const now = new Date();
                    const total = end - start;
                    const elapsed = Math.max(0, Math.min(now - start, total));
                    const fixedPct = total > 0 ? Math.min(100, Math.round(elapsed / total * 100)) : 0;

                    cardHTML += `
                            <div class="debt-detail">
                                <strong>Monthly Amount:</strong> ${this.formatCurrency(debt.fixedAmount)}
                            </div>
                            <div class="debt-detail">
                                <strong>Period:</strong> ${debt.fixedStartDate} to ${debt.fixedEndDate}
                            </div>
                            ${debt.priority ? `
                                <div class="debt-detail">
                                    <strong>Priority:</strong> ${debt.priority}/100
                                </div>
                            ` : ''}`;
                    cardHTML += `</div>
                        <div class="debt-progress-wrap">
                            <div class="debt-progress-label"><span>Time elapsed</span><span>${fixedPct}%</span></div>
                            <div class="debt-progress-bar"><div class="debt-progress-fill${fixedPct >= 100 ? ' debt-progress-fill--complete' : ''}" style="width:${fixedPct}%"></div></div>
                        </div>`;
                } else {
                    // Credit card debt: neg-amort check + progress bar
                    const dailyRate = (debt.interestRate || 0) / 100 / 365;
                    const monthlyInterest = debt.accountBalance * (Math.pow(1 + dailyRate, 30) - 1);
                    const negAmortRisk = debt.minimumPayment <= monthlyInterest && debt.minimumPayment > 0;
                    const origBal = debt.originalBalance || debt.accountBalance;
                    const progressPct = origBal > 0 ? Math.min(100, Math.round((origBal - debt.accountBalance) / origBal * 100)) : 0;
                    const iptd = this.computeInterestPaidToDate(debt);

                    cardHTML += `
                            <div class="debt-detail">
                                <strong>Balance:</strong> ${this.formatCurrency(debt.accountBalance)}
                                ${origBal > debt.accountBalance ? `<span style="font-size:0.78em;color:#6b7280;margin-left:6px;">(was ${this.formatCurrency(origBal)})</span>` : ''}
                            </div>
                            <div class="debt-detail">
                                <strong>Interest:</strong> ${debt.interestRate.toFixed(2)}%
                                <span style="font-size:0.78em;color:#6b7280;margin-left:4px;">≈ ${this.formatCurrency(monthlyInterest)}/mo</span>
                            </div>
                            <div class="debt-detail">
                                <strong>Min Payment:</strong> ${this.formatCurrency(debt.minimumPayment)}
                                ${debt.originalMinimumPayment !== undefined && debt.originalMinimumPayment !== debt.minimumPayment
                                    ? `<span style="font-size:0.78em;color:#6b7280;margin-left:6px;">(originally ${this.formatCurrency(debt.originalMinimumPayment)})</span>`
                                    : ''}
                                ${negAmortRisk ? `<span class="neg-amort-badge" title="Your minimum payment barely covers interest — the balance may never decrease!">⚠️ Neg. amortization risk</span>` : ''}
                            </div>
                            <div class="debt-detail">
                                <strong>Due Date:</strong> ${this.getDayOrdinal(debt.dueDate)} of month
                            </div>
                            ${debt.debtStartDate ? `
                            <div class="debt-detail">
                                <strong>Opened:</strong> ${new Date(debt.debtStartDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </div>` : ''}
                            ${iptd ? `
                            <div class="debt-detail iptd-detail">
                                <strong>Est. interest paid to date:</strong>
                                <span class="iptd-value">${this.formatCurrency(iptd.interestPaid)}</span>
                                <span class="iptd-sub">over ${iptd.days} days since ${iptd.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                            </div>` : ''}
                            ${debt.priority ? `
                                <div class="debt-detail">
                                    <strong>Priority:</strong> ${debt.priority}/100
                                </div>
                            ` : ''}`;
                    cardHTML += `</div>
                        <div class="debt-progress-wrap">
                            <div class="debt-progress-label"><span>Payoff progress</span><span>${progressPct}%</span></div>
                            <div class="debt-progress-bar"><div class="debt-progress-fill${progressPct >= 100 ? ' debt-progress-fill--complete' : ''}" style="width:${progressPct}%"></div></div>
                        </div>`;
                }
                
                cardHTML += `
                            ${debt.category ? `
                                <div class="debt-detail">
                                    <strong>Category:</strong> ${debt.category}
                                </div>
                            ` : ''}
                    </div>
                    <div class="debt-actions">
                        <button class="btn-edit" onclick="app.startEdit(${debt.id})">Edit</button>
                        ${debt.debtType !== 'fixedAmount' ? `<button class="btn btn-secondary btn-small" onclick="app.showUpdateBalanceModal(${debt.id})">Update Balance</button>` : ''}
                        <button class="btn-delete" onclick="app.deleteDebt(${debt.id})">Delete</button>
                    </div>
                `;
                card.innerHTML = cardHTML;
            }
            debtsList.appendChild(card);
        }
    }

    /**
     * Enter inline-edit mode for a debt card.
     * Sets `this.editingDebtId` and re-renders the list so the card is
     * replaced with an editable form. Focuses the name field after render.
     * @param {number} debtId - ID of the debt to edit
     */
    startEdit(debtId) {
        // Enable inline editing for this debt
        const debt = this.debts.find(d => d.id === debtId);
        if (!debt) return;

        this.editingDebtId = debtId;
        this.updateUI();
        // focus the first input after render
        setTimeout(() => {
            const el = document.getElementById(`inline-name-${debtId}`);
            if (el) el.focus();
        }, 0);
    }

    /**
     * Validate and persist the inline-edit form for a debt card.
     * Handles both `fixedAmount` and `creditCard` debt types, reading the
     * appropriate inline input elements. After saving, auto-recalculates the
     * payment plan if a monthly payment is already set.
     * @param {number} debtId - ID of the debt being saved
     */
    saveInlineEdit(debtId) {
        const nameEl    = document.getElementById(`inline-name-${debtId}`);
        const catEl     = document.getElementById(`inline-category-${debtId}`);
        const acctEl    = document.getElementById(`inline-account-${debtId}`);
        
        if (!nameEl) {
            alert('Missing debt name field');
            return;
        }

        const name      = nameEl.value.trim();
        const category  = catEl ? catEl.value.trim() : '';
        const accountId = acctEl?.value ? parseInt(acctEl.value) : null;
        const debt = this.debts.find(d => d.id === debtId);
        
        if (!debt) return;

        // Get the appropriate fields based on debt type
        if (debt.debtType === 'fixedAmount') {
            const amountEl = document.getElementById(`inline-fixed-amount-${debtId}`);
            const startEl = document.getElementById(`inline-start-date-${debtId}`);
            const endEl = document.getElementById(`inline-end-date-${debtId}`);
            const prioEl = document.getElementById(`inline-priority-${debtId}`);
            
            if (!amountEl || !startEl || !endEl) {
                alert('Missing form elements for inline edit');
                return;
            }
            
            const fixedAmount = parseFloat(amountEl.value);
            const fixedStartDate = startEl.value;
            const fixedEndDate = endEl.value;
            const priority = prioEl && prioEl.value !== '' ? parseInt(prioEl.value) : null;
            
            if (isNaN(fixedAmount) || !fixedStartDate || !fixedEndDate) {
                alert('Please fill in all required fields');
                return;
            }
            
            if (new Date(fixedStartDate) >= new Date(fixedEndDate)) {
                alert('Start date must be before end date');
                return;
            }
            
            const idx = this.debts.findIndex(d => d.id === debtId);
            if (idx === -1) return;
            
            this.debts[idx] = {
                ...this.debts[idx],
                name,
                fixedAmount,
                fixedStartDate,
                fixedEndDate,
                priority,
                category,
                accountId
            };
        } else {
            // Credit card debt
            const balEl = document.getElementById(`inline-balance-${debtId}`);
            const intEl = document.getElementById(`inline-interest-${debtId}`);
            const minEl = document.getElementById(`inline-min-${debtId}`);
            const dueEl = document.getElementById(`inline-due-${debtId}`);
            const prioEl = document.getElementById(`inline-priority-${debtId}`);

            if (!balEl || !intEl || !minEl || !dueEl) {
                alert('Missing form elements for inline edit');
                return;
            }

            const accountBalance = parseFloat(balEl.value);
            const interestRate = parseFloat(intEl.value);
            const minimumPayment = parseFloat(minEl.value);
            const dueDate = parseInt(dueEl.value);
            const priority = prioEl && prioEl.value ? parseInt(prioEl.value) : null;

            // Resolve idx here so debtStartDate fallback can safely reference it
            const idx = this.debts.findIndex(d => d.id === debtId);
            if (idx === -1) return;

            const startDateEl = document.getElementById(`inline-start-date-cc-${debtId}`);
            const debtStartDate = startDateEl ? (startDateEl.value || null) : this.debts[idx]?.debtStartDate || null;

            if (!name || isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
                alert('Please fill in all required fields');
                return;
            }

            this.debts[idx] = {
                ...this.debts[idx],
                name,
                accountBalance,
                interestRate,
                priority,
                minimumPayment,
                dueDate,
                debtStartDate,
                category,
                accountId
            };
        }

        this.saveToStorage();
        // Auto-recalculate if monthly payment set
        try {
            const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
            const strategy = document.getElementById('paymentStrategy').value;
            if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                const result = DebtCalculator.calculatePaymentPlan(this.debts, monthlyPayment, strategy, this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0);
                this.lastPaymentPlan = result.paymentPlan;
                this.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
            }
        } catch (err) {
            console.error('Error recalculating after inline save', err);
        }

        this.editingDebtId = null;
        this.updateUI();
    }

    /** Discard inline edits and return the card to read-only view. */
    cancelInlineEdit() {
        this.editingDebtId = null;
        this.updateUI();
    }

    /**
     * Save changes from the full-page edit form (legacy modal edit path).
     * Validates required fields, updates the debt in `this.debts`, and
     * auto-recalculates the plan if a monthly payment is set.
     */
    saveEdit() {
        if (!this.editingDebtId) return;

        const name = document.getElementById('debtName').value.trim();
        const accountBalance = parseFloat(document.getElementById('accountBalance').value);
        const interestRate = parseFloat(document.getElementById('interestRate').value);
        const priority = document.getElementById('priority').value ? parseInt(document.getElementById('priority').value) : null;
        const minimumPayment = parseFloat(document.getElementById('minimumPayment').value);
        const dueDate = parseInt(document.getElementById('dueDate').value);

        if (!name || isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
            alert('Please fill in all required fields');
            return;
        }

        const idx = this.debts.findIndex(d => d.id === this.editingDebtId);
        if (idx === -1) return;

        this.debts[idx] = {
            ...this.debts[idx],
            name,
            accountBalance,
            interestRate,
            priority,
            minimumPayment,
            dueDate
        };

        this.saveToStorage();
        this.updateUI();
        // Optionally auto-recalculate if monthly payment is set
        try {
            const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
            const strategy = document.getElementById('paymentStrategy').value;
            if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                const result = DebtCalculator.calculatePaymentPlan(this.debts, monthlyPayment, strategy, this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0);
                this.lastPaymentPlan = result.paymentPlan;
                this.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
            }
        } catch (err) {
            console.error('Error recalculating after saveEdit', err);
        }

        this.cancelEdit();
    }

    /** Reset the Add Debt form to its blank state and hide the Cancel button. */
    cancelEdit() {
        this.editingDebtId = null;
        document.getElementById('debtForm').reset();
        const submitBtn = document.getElementById('debtFormSubmit');
        if (submitBtn) submitBtn.textContent = 'Add Debt';
        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (typeof window.closeDebtForm === 'function') window.closeDebtForm();
    }

    // ─── Income ───────────────────────────────────────────────────────────────

    /**
     * Read the Add Income form, validate, build an income object, and save.
     *
     * Income object shape:
     *   { id, name, amount, firstPayDate, frequency }
     *   frequency: 'biweekly' | 'monthly'
     */
    addIncome() {
        const name = document.getElementById('incomeName').value.trim();
        const amount = parseFloat(document.getElementById('incomeAmount').value);
        const firstPayDate = document.getElementById('incomeFirstDate').value;
        const frequency = document.getElementById('incomeFrequency').value;
        const accountId = parseInt(document.getElementById('incomeAccount')?.value) || null;

        if (!name) { alert('Please enter a name for this income source.'); return; }
        if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
        if (!firstPayDate) { alert('Please enter the first pay date.'); return; }

        this.incomes.push({ id: Date.now(), name, amount, firstPayDate, frequency, accountId });
        this.saveToStorage();
        this.renderIncomeList();
        document.getElementById('incomeForm').reset();
    }

    /**
     * Remove an income source by ID.
     * @param {number} incomeId
     */
    deleteIncome(incomeId) {
        this.incomes = this.incomes.filter(i => i.id !== incomeId);
        this.saveToStorage();
        this.renderIncomeList();
        this.renderStrategyIncomeWidget();
    }

    /** Enter inline-edit mode for an income card. */
    startEditIncome(incomeId) {
        this.editingIncomeId = incomeId;
        this.renderIncomeList();
        setTimeout(() => {
            const el = document.getElementById(`ie-name-${incomeId}`);
            if (el) el.focus();
        }, 0);
    }

    /** Cancel inline-edit without saving. */
    cancelEditIncome() {
        this.editingIncomeId = null;
        this.renderIncomeList();
    }

    /** Validate and save the inline-edit form for an income card. */
    saveEditIncome(incomeId) {
        const nameEl      = document.getElementById(`ie-name-${incomeId}`);
        const amountEl    = document.getElementById(`ie-amount-${incomeId}`);
        const dateEl      = document.getElementById(`ie-date-${incomeId}`);
        const freqEl      = document.getElementById(`ie-freq-${incomeId}`);
        const accountEl   = document.getElementById(`ie-account-${incomeId}`);

        if (!nameEl || !amountEl || !dateEl || !freqEl) return;

        const name        = nameEl.value.trim();
        const amount      = parseFloat(amountEl.value);
        const firstPayDate = dateEl.value;
        const frequency   = freqEl.value;
        const accountId   = accountEl?.value ? parseInt(accountEl.value) : null;

        if (!name)                        { alert('Please enter a name.');            return; }
        if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount.');     return; }
        if (!firstPayDate)                { alert('Please select a first pay date.');  return; }

        const idx = this.incomes.findIndex(i => i.id === incomeId);
        if (idx === -1) return;

        this.incomes[idx] = { ...this.incomes[idx], name, amount, firstPayDate, frequency, accountId };
        this.editingIncomeId = null;
        this.saveToStorage();
        this.renderIncomeList();
        this.renderStrategyIncomeWidget();
    }

    // ── Bonus / Windfall CRUD ────────────────────────────────────────────────

    /** Add a new one-time bonus from the bonus form. */
    addBonus() {
        const name      = document.getElementById('bonusName').value.trim();
        const amount    = parseFloat(document.getElementById('bonusAmount').value);
        const date      = document.getElementById('bonusDate').value;
        const category  = document.getElementById('bonusCategory').value;
        const accountId = parseInt(document.getElementById('bonusAccount')?.value) || null;

        if (!name)                        { alert('Please enter a label for this bonus.'); return; }
        if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount greater than 0.'); return; }
        if (!date)                        { alert('Please enter the date received.'); return; }

        this.bonuses.push({ id: Date.now(), name, amount, date, category, accountId });
        this.saveToStorage();
        this.renderBonusList();
        this.renderStrategyIncomeWidget();
        document.getElementById('bonusForm').reset();
    }

    /** Delete a bonus by ID. */
    deleteBonus(bonusId) {
        this.bonuses = this.bonuses.filter(b => b.id !== bonusId);
        this.saveToStorage();
        this.renderBonusList();
        this.renderStrategyIncomeWidget();
    }

    /** Enter inline-edit mode for a bonus card. */
    startEditBonus(bonusId) {
        this.editingBonusId = bonusId;
        this.renderBonusList();
        setTimeout(() => {
            const el = document.getElementById(`be-name-${bonusId}`);
            if (el) el.focus();
        }, 0);
    }

    /** Cancel inline-edit for a bonus card. */
    cancelEditBonus() {
        this.editingBonusId = null;
        this.renderBonusList();
    }

    /** Save inline-edit for a bonus card. */
    saveEditBonus(bonusId) {
        const nameEl      = document.getElementById(`be-name-${bonusId}`);
        const amtEl       = document.getElementById(`be-amount-${bonusId}`);
        const dateEl      = document.getElementById(`be-date-${bonusId}`);
        const catEl       = document.getElementById(`be-category-${bonusId}`);
        const accountEl   = document.getElementById(`be-account-${bonusId}`);
        if (!nameEl || !amtEl || !dateEl || !catEl) return;

        const name      = nameEl.value.trim();
        const amount    = parseFloat(amtEl.value);
        const date      = dateEl.value;
        const category  = catEl.value;
        const accountId = accountEl?.value ? parseInt(accountEl.value) : null;

        if (!name)                        { alert('Please enter a label.'); return; }
        if (isNaN(amount) || amount <= 0) { alert('Please enter a valid amount.'); return; }
        if (!date)                        { alert('Please select a date.'); return; }

        const idx = this.bonuses.findIndex(b => b.id === bonusId);
        if (idx === -1) return;
        this.bonuses[idx] = { ...this.bonuses[idx], name, amount, date, category, accountId };
        this.editingBonusId = null;
        this.saveToStorage();
        this.renderBonusList();
        this.renderStrategyIncomeWidget();
    }

    /**
     * Render the list of one-time bonuses below the bonus form on the Income page.
     */
    renderBonusList() {
        const container = document.getElementById('bonusList');
        if (!container) return;

        if (!this.bonuses || this.bonuses.length === 0) {
            container.innerHTML = '';
            return;
        }

        const now   = new Date();
        const year  = now.getFullYear();
        const month = now.getMonth();
        const catBadgeClass = { Bonus: 'bonus-cat--bonus', 'Tax Refund': 'bonus-cat--tax', Other: 'bonus-cat--other' };

        container.innerHTML = `
        <div class="bonus-list-wrap">
            <h4 class="bonus-list-title">One-time Bonuses &amp; Windfalls</h4>
            ${this.bonuses.map(b => {
                const d = new Date(b.date + 'T12:00:00');
                const isThisMonth = d.getFullYear() === year && d.getMonth() === month;
                const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                const badgeCls = catBadgeClass[b.category] || 'bonus-cat--other';

                if (this.editingBonusId === b.id) {
                    return `
                    <div class="bonus-card bonus-card--editing">
                        <div class="bonus-edit-grid">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Label</label>
                                <input type="text" id="be-name-${b.id}" value="${b.name.replace(/"/g,'&quot;')}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Amount ($)</label>
                                <input type="number" id="be-amount-${b.id}" value="${b.amount}" min="0.01" step="0.01" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Date received</label>
                                <input type="date" id="be-date-${b.id}" value="${b.date}" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Category</label>
                                <select id="be-category-${b.id}" style="width:100%;">
                                    <option value="Bonus"      ${b.category==='Bonus'      ?'selected':''}>Bonus</option>
                                    <option value="Tax Refund" ${b.category==='Tax Refund' ?'selected':''}>Tax Refund</option>
                                    <option value="Other"      ${b.category==='Other'      ?'selected':''}>Other</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Account</label>
                                <select id="be-account-${b.id}" style="width:100%;">
                                    <option value="">— No account —</option>
                                    ${this.accounts.map(a => `<option value="${a.id}" ${b.accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions" style="margin-top:10px;">
                            <button class="btn btn-primary btn-small" onclick="app.saveEditBonus(${b.id})">Save</button>
                            <button class="btn btn-secondary btn-small" onclick="app.cancelEditBonus()">Cancel</button>
                        </div>
                    </div>`;
                }

                return `
                <div class="bonus-card${isThisMonth ? ' bonus-card--current' : ''}">
                    <div class="bonus-card-info">
                        <span class="bonus-card-name">${b.name}</span>
                        <span class="bonus-card-amount">${this.formatCurrency(b.amount)}</span>
                        <span class="bonus-card-meta">${dateStr} &nbsp;·&nbsp; <span class="bonus-cat-badge ${badgeCls}">${b.category}</span></span>
                        ${isThisMonth ? '<span class="bonus-this-month-tag">✅ Included in this month\'s income</span>' : ''}
                    </div>
                    <div class="debt-actions">
                        <button class="btn-edit" onclick="app.startEditBonus(${b.id})">Edit</button>
                        <button class="btn btn-danger btn-small" onclick="app.deleteBonus(${b.id})">Delete</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }

    /**
     * Render the income list and summary panel inside the Income page.
     */
    renderIncomeList() {
        const container = document.getElementById('incomeList');
        const summaryEl = document.getElementById('incomeSummary');
        if (!container) return;

        if (this.incomes.length === 0) {
            container.innerHTML = `<p class="empty-income-msg" style="color:#9ca3af;font-style:italic;margin:8px 0 0 0;">No income sources added yet.</p>`;
            if (summaryEl) summaryEl.style.display = 'none';
            return;
        }

        const freqLabel = { biweekly: 'Every other week', monthly: 'Once per month' };

        container.innerHTML = this.incomes.map(inc => {
            // ── Inline edit mode ──────────────────────────────────────────
            if (this.editingIncomeId === inc.id) {
                return `
                <div class="income-card income-card--editing">
                    <div class="income-edit-form">
                        <div class="income-edit-grid">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Name</label>
                                <input type="text" id="ie-name-${inc.id}" value="${inc.name.replace(/"/g, '&quot;')}" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Amount per paycheck ($)</label>
                                <input type="number" id="ie-amount-${inc.id}" value="${inc.amount}" min="0.01" step="0.01" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">First pay date</label>
                                <input type="date" id="ie-date-${inc.id}" value="${inc.firstPayDate}" class="form-control" style="width:100%;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Frequency</label>
                                <select id="ie-freq-${inc.id}" class="form-control" style="width:100%;">
                                    <option value="biweekly" ${inc.frequency === 'biweekly' ? 'selected' : ''}>Every other week</option>
                                    <option value="monthly"  ${inc.frequency === 'monthly'  ? 'selected' : ''}>Once per month</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem;font-weight:600;">Account</label>
                                <select id="ie-account-${inc.id}" class="form-control" style="width:100%;">
                                    <option value="">— No account —</option>
                                    ${this.accounts.map(a => `<option value="${a.id}" ${inc.accountId === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="income-edit-actions">
                            <button class="btn btn-primary btn-small" onclick="app.saveEditIncome(${inc.id})">Save</button>
                            <button class="btn btn-secondary btn-small" onclick="app.cancelEditIncome()">Cancel</button>
                        </div>
                    </div>
                </div>`;
            }

            // ── Normal display mode ───────────────────────────────────────
            const dateStr = new Date(inc.firstPayDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const pdays = this.paydaysInCurrentMonth(inc);
            const pdayLabel = pdays === 1 ? '1 payday this month' : `${pdays} paydays this month`;

            const upcomingDates = this.nextPayDates(inc, 3);
            const upcomingHTML = upcomingDates.length
                ? upcomingDates.map(d => {
                    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return `<span class="income-upcoming-chip">${label}</span>`;
                  }).join('')
                : '';

            return `
            <div class="income-card">
                <div class="income-card-info">
                    <span class="income-card-name">${inc.name}</span>
                    <span class="income-card-amount">${this.formatCurrency(inc.amount)}</span>
                    <span class="income-card-detail">First pay: ${dateStr}</span>
                    <span class="income-card-freq">${freqLabel[inc.frequency] || inc.frequency} &mdash; ${pdayLabel}</span>
                    ${upcomingHTML ? `<span class="income-card-upcoming-label">Next paydays:</span>${upcomingHTML}` : ''}
                </div>
                <div class="debt-actions">
                    <button class="btn-edit" onclick="app.startEditIncome(${inc.id})">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="app.deleteIncome(${inc.id})">Delete</button>
                </div>
            </div>`;
        }).join('');

        // Summary panel
        if (summaryEl) {
            const { monthlyTotal } = this.computeMonthlyIncome();
            const bonusThisMonth   = this.computeMonthlyBonuses();
            const regularThisMonth = monthlyTotal - bonusThisMonth;
            const totalAnnual = this.incomes.reduce((s, i) => {
                return s + (i.frequency === 'biweekly' ? i.amount * 26 : i.amount * 12);
            }, 0);

            const bonusRow = bonusThisMonth > 0
                ? `<div class="income-summary-item">
                       <span class="income-summary-label">Bonuses this month</span>
                       <span class="income-summary-value income-summary-value--bonus">${this.formatCurrency(bonusThisMonth)}</span>
                   </div>`
                : '';

            summaryEl.style.display = 'block';
            summaryEl.innerHTML = `
                <h4>📅 Estimated Income Summary</h4>
                <div class="income-summary-grid">
                    <div class="income-summary-item">
                        <span class="income-summary-label">Expected this month</span>
                        <span class="income-summary-value">${this.formatCurrency(monthlyTotal)}</span>
                    </div>
                    <div class="income-summary-item">
                        <span class="income-summary-label">Regular pay this month</span>
                        <span class="income-summary-value">${this.formatCurrency(regularThisMonth)}</span>
                    </div>
                    ${bonusRow}
                    <div class="income-summary-item">
                        <span class="income-summary-label">Income sources</span>
                        <span class="income-summary-value">${this.incomes.length}</span>
                    </div>
                    <div class="income-summary-item">
                        <span class="income-summary-label">Estimated annual</span>
                        <span class="income-summary-value">${this.formatCurrency(totalAnnual)}</span>
                    </div>
                </div>`;
        }
    }

    /**
     * Compute the total income expected in the current calendar month by
     * projecting each source's pay schedule forward from its first pay date.
     *
     * - biweekly: every 14 days from firstPayDate
     * - monthly:  same day each month as firstPayDate
     *
     * @returns {{ monthlyTotal: number, paydaysThisMonth: number }}
     */
    /**
     * Count how many paydays fall in the current calendar month for a
     * single income source.
     * @param {object} inc - income source object
     * @returns {number}
     */
    /**
     * Return the next `n` upcoming pay dates for an income source (on or after today).
     * @param {object} inc - income source object
     * @param {number} n   - how many dates to return
     * @returns {Date[]}
     */
    nextPayDates(inc, n = 3) {
        const msPerDay = 24 * 60 * 60 * 1000;
        const first = new Date(inc.firstPayDate + 'T12:00:00');
        if (isNaN(first.getTime())) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dates = [];

        if (inc.frequency === 'biweekly') {
            // Advance from firstPayDate in 14-day steps until we reach today or beyond
            let pay = new Date(first);
            const diffDays = Math.floor((today - pay) / msPerDay);
            if (diffDays > 0) {
                const periods = Math.floor(diffDays / 14);
                pay = new Date(pay.getTime() + periods * 14 * msPerDay);
            }
            while (pay < today) pay = new Date(pay.getTime() + 14 * msPerDay);
            while (dates.length < n) {
                dates.push(new Date(pay));
                pay = new Date(pay.getTime() + 14 * msPerDay);
            }
        } else {
            // monthly: same day-of-month as firstPayDate
            const payDay = first.getDate();
            let yr = today.getFullYear();
            let mo = today.getMonth();
            // find first occurrence on or after today
            while (dates.length < n) {
                const candidate = new Date(yr, mo, payDay, 12, 0, 0);
                if (candidate >= today) dates.push(candidate);
                mo++;
                if (mo > 11) { mo = 0; yr++; }
            }
        }
        return dates;
    }

    paydaysInCurrentMonth(inc) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const monthStart = new Date(year, month, 1);
        const monthEnd   = new Date(year, month + 1, 0);
        const msPerDay   = 24 * 60 * 60 * 1000;

        const first = new Date(inc.firstPayDate + 'T12:00:00');
        if (isNaN(first.getTime())) return 0;

        if (inc.frequency === 'biweekly') {
            let pay = new Date(first);
            const diffDays = Math.floor((monthStart - pay) / msPerDay);
            const periods  = Math.floor(diffDays / 14);
            pay = new Date(pay.getTime() + periods * 14 * msPerDay);
            while (pay < monthStart) pay = new Date(pay.getTime() + 14 * msPerDay);
            let count = 0;
            while (pay <= monthEnd) {
                count++;
                pay = new Date(pay.getTime() + 14 * msPerDay);
            }
            return count;
        } else {
            const payDay   = first.getDate();
            const candidate = new Date(year, month, payDay);
            return (candidate >= monthStart && candidate <= monthEnd) ? 1 : 0;
        }
    }

    computeMonthlyIncome() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        let monthlyTotal = 0;

        for (const inc of this.incomes) {
            const count = this.paydaysInCurrentMonth(inc);
            monthlyTotal += inc.amount * count;
        }

        // Add any bonuses whose date falls in the current calendar month
        monthlyTotal += this.computeMonthlyBonuses();

        return { monthlyTotal };
    }

    /**
     * Sum of all one-time bonuses whose date falls in the current calendar month.
     * @returns {number}
     */
    computeMonthlyBonuses() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        return (this.bonuses || []).reduce((sum, b) => {
            if (!b.date) return sum;
            const d = new Date(b.date + 'T12:00:00');
            if (d.getFullYear() === year && d.getMonth() === month) {
                return sum + (b.amount || 0);
            }
            return sum;
        }, 0);
    }

    /**
     * Render (or hide) the income context widget on the Strategy page.
     * Shows monthly expected income alongside the current monthly payment
     * commitment so the user can see the ratio at a glance.
     */
    renderStrategyIncomeWidget() {
        const widget = document.getElementById('strategyIncomeWidget');
        if (!widget) return;
        if (this.incomes.length === 0) { widget.style.display = 'none'; return; }

        const { monthlyTotal } = this.computeMonthlyIncome();
        const paymentEl = document.getElementById('monthlyPayment');
        const paymentAmt = paymentEl ? (parseFloat(paymentEl.value) || 0) : 0;

        const pct = monthlyTotal > 0 ? (paymentAmt / monthlyTotal * 100) : 0;
        const isWarn = pct > 40;

        let ratioHtml = '';
        if (paymentAmt > 0 && monthlyTotal > 0) {
            ratioHtml = `<div class="strategy-income-ratio${isWarn ? ' strategy-income-ratio--warn' : ''}">
                Your planned payment is <strong>${pct.toFixed(1)}%</strong> of your expected monthly income
                ${isWarn ? ' — that\'s a high debt-to-income ratio (>40%).' : '.'}
            </div>`;
        }

        const totalBills    = (this.bills    || []).reduce((s, b) => s + b.amount, 0);
        const totalExpenses = (this.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
        const totalDebtMin  = this.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
        const bonusThisMonth = this.computeMonthlyBonuses();
        const netAfterAll   = monthlyTotal - totalDebtMin - totalBills - totalExpenses;

        let netHtml = '';
        if (totalBills > 0 || totalExpenses > 0) {
            const netClass = netAfterAll >= 0 ? 'strategy-net--positive' : 'strategy-net--negative';
            const bonusBit = bonusThisMonth > 0
                ? ` · Bonuses: ${this.formatCurrency(bonusThisMonth)}` : '';
            netHtml = `<div class="strategy-net ${netClass}">
                Net after all obligations:
                <strong>${this.formatCurrency(netAfterAll)}</strong>
                <span class="strategy-net-breakdown">(Bills: ${this.formatCurrency(totalBills)} · Expenses: ${this.formatCurrency(totalExpenses)} · Debt mins: ${this.formatCurrency(totalDebtMin)}${bonusBit})</span>
            </div>`;
        }

        const bonusChip = bonusThisMonth > 0
            ? `<span class="strategy-bonus-chip">+${this.formatCurrency(bonusThisMonth)} bonus this month</span>` : '';

        widget.style.display = 'block';
        widget.innerHTML = `
            💰 Expected income this month: <strong>${this.formatCurrency(monthlyTotal)}</strong> ${bonusChip}
            ${ratioHtml}
            ${netHtml}`;
    }

    /**
     * Download all current debts as a JSON backup file.
     * The file format is:
     * ```json
     * { "version": "1.0", "exportedAt": "<ISO date>", "debts": [...] }
     * ```
     * The file is named `debts-backup-YYYY-MM-DD.json`.
     */
    /**
     * Export a full app backup as JSON — includes debts, income sources,
     * monthly payment, and selected strategy.
     */
    exportAllJSON() {
        // Normalise each debt so both accountBalance and originalBalance are always
        // present in the export, even if Update Balance was never used.
        const normalisedDebts = this.debts.map(d => ({
            ...d,
            accountBalance:  d.accountBalance  ?? 0,
            originalBalance: d.originalBalance ?? d.accountBalance ?? 0
        }));

        const payload = {
            version: '3.0',
            exportedAt: new Date().toISOString(),
            accounts: this.accounts || [],
            debts: normalisedDebts,
            incomes: this.incomes || [],
            bonuses: this.bonuses || [],
            bills: this.bills || [],
            expenses: this.expenses || [],
            strategy: {
                monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
                paymentStrategy: document.getElementById('paymentStrategy')?.value || null
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debt-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import a full backup JSON file created by `exportAllJSON`.
     * Also accepts legacy v1.0 files (debts only).
     * Prompts the user to choose Replace or Merge for debts; income and
     * strategy are always restored from the file when present.
     * @param {File} file
     */
    importAllJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            let parsed;
            try {
                parsed = JSON.parse(e.target.result);
            } catch {
                alert('Invalid JSON file. Please select a valid backup file.');
                return;
            }

            // Accept bare array (very old), v1.0 envelope (debts only), or v2.0/v3.0 envelope
            const incomingDebts    = Array.isArray(parsed) ? parsed : (parsed.debts    || []);
            const incomingAccounts = parsed.accounts  || [];
            const incomingIncomes  = parsed.incomes   || [];
            const incomingBonuses  = parsed.bonuses   || [];
            const incomingBills    = parsed.bills     || [];
            const incomingExpenses = parsed.expenses  || [];
            const incomingStrategy = parsed.strategy || null;

            const validDebts = incomingDebts.filter(d => d && typeof d.name === 'string' && d.name.trim());

            if (validDebts.length === 0 && incomingIncomes.length === 0 && !incomingStrategy
                && incomingBills.length === 0 && incomingExpenses.length === 0) {
                alert('No recognisable data found in the selected file.');
                return;
            }

            // Build a summary for the confirm dialog
            const parts = [];
            if (incomingAccounts.length) parts.push(`${incomingAccounts.length} account(s)`);
            if (validDebts.length)    parts.push(`${validDebts.length} debt(s)`);
            if (incomingIncomes.length) parts.push(`${incomingIncomes.length} income source(s)`);
            if (incomingBills.length) parts.push(`${incomingBills.length} bill(s)`);
            if (incomingExpenses.length) parts.push(`${incomingExpenses.length} expense budget(s)`);
            if (incomingStrategy?.monthlyPayment || incomingStrategy?.paymentStrategy) parts.push('strategy settings');

            const action = confirm(
                `Found: ${parts.join(', ')}.\n\n` +
                `• OK     — Replace your current data entirely\n` +
                `• Cancel — Merge debts only (income & strategy will still be restored; duplicate debt names are skipped)\n`
            );

            if (action) {
                // Full replace — preserve both balance fields
                this.accounts = incomingAccounts.map((a, i) => ({ ...a, id: Date.now() + 500 + i }));
                this.debts = validDebts.map((d, i) => ({
                    ...d,
                    id: Date.now() + i,
                    accountBalance:  d.accountBalance  ?? 0,
                    originalBalance: d.originalBalance ?? d.accountBalance ?? 0
                }));
                this.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
                this.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
                this.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
                this.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
            } else {
                // Merge debts — skip duplicates by name
                const existingNames = new Set(this.debts.map(d => d.name.toLowerCase()));
                let skipped = 0;
                const toAdd = [];
                for (const d of validDebts) {
                    if (existingNames.has(d.name.toLowerCase())) {
                        skipped++;
                    } else {
                        toAdd.push({
                            ...d,
                            id: Date.now() + toAdd.length,
                            accountBalance:  d.accountBalance  ?? 0,
                            originalBalance: d.originalBalance ?? d.accountBalance ?? 0
                        });
                        existingNames.add(d.name.toLowerCase());
                    }
                }
                this.debts = [...this.debts, ...toAdd];
                if (skipped > 0) {
                    alert(`Merged ${toAdd.length} debt(s). Skipped ${skipped} duplicate name(s).`);
                }
                // Always restore accounts, income, bonuses, bills, expenses & strategy on merge
                this.accounts = incomingAccounts.map((a, i) => ({ ...a, id: Date.now() + 500 + i }));
                this.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
                this.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
                this.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
                this.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
            }

            // Restore strategy fields into the DOM
            if (incomingStrategy) {
                const mpEl = document.getElementById('monthlyPayment');
                const psEl = document.getElementById('paymentStrategy');
                if (mpEl && incomingStrategy.monthlyPayment) mpEl.value = incomingStrategy.monthlyPayment;
                if (psEl && incomingStrategy.paymentStrategy) psEl.value = incomingStrategy.paymentStrategy;
            }

            this.saveToStorage();
            this.updateUI();
        };

        reader.onerror = () => alert('Could not read the file. Please try again.');
        reader.readAsText(file);
    }

    /**
     * Wipe all debts and reset every piece of app state, then confirm to the user.
     * Clears `this.debts`, `this.lastPaymentPlan`, `this.lastSummary`, and
     * `this.perMonthStimulus`, removes data from localStorage, and resets all
     * form fields.
     */
    clearAllData() {
        this.debts = [];
        this.accounts = [];
        this.lastPaymentPlan = null;
        this.lastSummary = null;
        this.perMonthStimulus = [];
        this.bonuses = [];
        this.saveToStorage();
        this.updateUI();
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('monthlyPayment').value = '';
        alert('All debt data has been cleared');
    }

    /**
     * Persist current state to localStorage under `this.storageKey`.
     * Saved keys: `debts`, `perMonthStimulus`, `monthlyPayment`, `strategy`, `timestamp`.
     */
    saveToStorage() {
        try {
            const data = {
                debts: this.debts,
                accounts: this.accounts || [],
                incomes: this.incomes || [],
                bonuses: this.bonuses || [],
                bills: this.bills || [],
                expenses: this.expenses || [],
                perMonthStimulus: this.perMonthStimulus || [],
                monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
                strategy: document.getElementById('paymentStrategy')?.value || null,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (error) {
            console.error('Error saving to localStorage:', error);
        }
    }

    /**
     * Restore state from localStorage.
     * Populates `this.debts`, `this.perMonthStimulus`, `this._savedMonthlyPayment`,
     * and `this._savedStrategy`. Silently ignores missing or corrupted data.
     */
    loadFromStorage() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                this.debts = parsed.debts || [];
                this.accounts = parsed.accounts || [];
                this.incomes = parsed.incomes || [];
                this.bonuses = parsed.bonuses || [];
                this.bills = parsed.bills || [];
                this.expenses = parsed.expenses || [];
                this.perMonthStimulus = parsed.perMonthStimulus || [];
                this._savedMonthlyPayment = parsed.monthlyPayment || null;
                this._savedStrategy = parsed.strategy || null;
            }
        } catch (error) {
            console.error('Error loading from localStorage:', error);
        }
    }

    /**
     * Format a number as a USD currency string (e.g., `1234.5` → `"$1,234.50"`).
     * @param {number} value
     * @returns {string}
     */
    formatCurrency(value) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    }

    /**
     * Return the ordinal suffix string for a day number (e.g., `1` → `"1st"`).
     * @param {number} day
     * @returns {string}
     */
    getDayOrdinal(day) {
        const j = day % 10;
        const k = day % 100;
        
        if (j === 1 && k !== 11) return day + 'st';
        if (j === 2 && k !== 12) return day + 'nd';
        if (j === 3 && k !== 13) return day + 'rd';
        return day + 'th';
    }

    /**
     * Activate a Results sub-tab by name.
     * Valid tab names: `'table'`, `'chart'`, `'calendar'`.
     * Side effects:
     *   - `'chart'` triggers `renderBalanceChart()`, `renderProgressChart()`, `renderPieChart()`
     *   - `'calendar'` triggers `renderCalendarView()`
     * @param {string} tabName
     */
    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        // Remove active class from all buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
        });

        // Show selected tab
        document.getElementById(`${tabName}-tab`).classList.add('active');

        // Add active class to clicked button
        event.target.classList.add('active');

        // If chart tab, render the chart
        if (tabName === 'chart') {
            this.renderBalanceChart();
            this.renderProgressChart();
            this.renderPieChart();
            this.renderDebtDistributionChart();
            this.renderDebtToIncomeChart();
        }
        if (tabName === 'calendar') {
            this.renderCalendarView();
        }
    }

    /**
     * Render the payment calendar for a given page (1 month per page).
     * Each month is drawn as a standard weekly grid. Debt payment events are
     * pinned to their `dueDate` day and colour-coded by debt. Today's cell
     * receives the `cal-today` CSS class. Prev/Next pagination buttons are
     * rendered at the top and bottom of the container.
     * @param {number} [page=0] - Zero-based page index
     */
    renderCalendarView(page = 0) {
        const container = document.getElementById('calendarView');
        if (!container || !this.lastPaymentPlan || this.lastPaymentPlan.length === 0) return;
        container.innerHTML = '';

        const MONTHS_PER_PAGE = 1;
        const msPerDay = 24 * 60 * 60 * 1000;

        // Build debt color map
        const debtColors = {};
        const palette = [
            '#2563eb','#dc2626','#d97706','#7c3aed',
            '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
        ];
        let colorIdx = 0;
        for (const debt of this.debts) {
            debtColors[debt.name] = palette[colorIdx++ % palette.length];
        }

        // ── Pre-compute income paydays per year-month ──────────────────────
        // Returns a Map keyed by "YYYY-M" → [{ name, amount, day }]
        const incomeByMonth = new Map();
        for (const inc of (this.incomes || [])) {
            const first = new Date(inc.firstPayDate + 'T12:00:00');
            if (isNaN(first.getTime())) continue;

            // Determine the date range to cover (same span as the payment plan)
            const planStart = this.lastPaymentPlan[0].date;
            const planEnd   = this.lastPaymentPlan[this.lastPaymentPlan.length - 1].date;

            if (inc.frequency === 'biweekly') {
                // Walk bi-weekly from firstPayDate; skip paydays before plan start
                let pay = new Date(first);
                // Align to plan start: step forward in 14-day increments until >= planStart
                while (pay < planStart) pay = new Date(pay.getTime() + 14 * msPerDay);
                while (pay <= new Date(planEnd.getFullYear(), planEnd.getMonth() + 1, 0)) {
                    const key = `${pay.getFullYear()}-${pay.getMonth()}`;
                    if (!incomeByMonth.has(key)) incomeByMonth.set(key, []);
                    incomeByMonth.get(key).push({ name: inc.name, amount: inc.amount, day: pay.getDate() });
                    pay = new Date(pay.getTime() + 14 * msPerDay);
                }
            } else {
                // monthly: same day-of-month each month
                const payDay = first.getDate();
                let y = planStart.getFullYear();
                let m = planStart.getMonth();
                const endY = planEnd.getFullYear();
                const endM = planEnd.getMonth();
                while (y < endY || (y === endY && m <= endM)) {
                    const daysInM = new Date(y, m + 1, 0).getDate();
                    const actualDay = Math.min(payDay, daysInM);
                    const key = `${y}-${m}`;
                    if (!incomeByMonth.has(key)) incomeByMonth.set(key, []);
                    incomeByMonth.get(key).push({ name: inc.name, amount: inc.amount, day: actualDay });
                    m++;
                    if (m > 11) { m = 0; y++; }
                }
            }
        }

        // Group debt payments by year/month into ordered array
        const monthMap = new Map();
        for (const monthData of this.lastPaymentPlan) {
            const d = monthData.date;
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (!monthMap.has(key)) {
                monthMap.set(key, { year: d.getFullYear(), month: d.getMonth(), payments: [] });
            }
            for (const payment of monthData.payments) {
                if (payment.payment <= 0) continue;
                const orig = this.debts.find(dbt => dbt.name === payment.debtName);
                const dueDay = orig?.dueDate || 1;
                monthMap.get(key).payments.push({
                    name: payment.debtName,
                    payment: payment.payment,
                    dueDay,
                    color: debtColors[payment.debtName] || '#2563eb'
                });
            }
        }

        const allMonths = [...monthMap.values()];
        const totalPages = Math.ceil(allMonths.length / MONTHS_PER_PAGE);
        page = Math.max(0, Math.min(page, totalPages - 1));
        const pageMonths = allMonths.slice(page * MONTHS_PER_PAGE, page * MONTHS_PER_PAGE + MONTHS_PER_PAGE);

        const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

        // Legend
        const hasIncome = (this.incomes || []).length > 0;
        const hasBills  = (this.bills  || []).some(b => b.dueDay);
        const legendDiv = document.createElement('div');
        legendDiv.className = 'cal-legend';
        legendDiv.innerHTML = `
            <span class="cal-legend-item"><span class="cal-legend-swatch" style="background:#2563eb;"></span>Debt payment</span>
            ${hasIncome ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--income"></span>Payday</span>` : ''}
            ${hasBills  ? `<span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--bill"></span>Bill due</span>` : ''}
            <span class="cal-legend-item"><span class="cal-legend-swatch cal-legend-swatch--today"></span>Today</span>
        `;
        container.appendChild(legendDiv);

        // Pagination controls
        const paginationTop = document.createElement('div');
        paginationTop.className = 'cal-pagination';
        paginationTop.innerHTML = `
            <button class="btn btn-secondary cal-prev" ${page === 0 ? 'disabled' : ''}>&#8592; Prev</button>
            <span class="cal-page-label">${page * MONTHS_PER_PAGE + 1}–${Math.min((page + 1) * MONTHS_PER_PAGE, allMonths.length)} of ${allMonths.length} months</span>
            <button class="btn btn-secondary cal-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>
        `;
        container.appendChild(paginationTop);

        // Month grid row
        const monthsRow = document.createElement('div');
        monthsRow.className = 'cal-months-row';

        const today = new Date();
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth();
        const todayDay = today.getDate();

        for (const { year, month, payments } of pageMonths) {
            const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

            // Group debt payments by due day
            const dayPayments = {};
            for (const p of payments) {
                if (!dayPayments[p.dueDay]) dayPayments[p.dueDay] = [];
                dayPayments[p.dueDay].push(p);
            }

            // Group income paydays for this month by day
            const monthKey = `${year}-${month}`;
            const incomeEvents = incomeByMonth.get(monthKey) || [];
            const dayIncome = {};
            for (const inc of incomeEvents) {
                if (!dayIncome[inc.day]) dayIncome[inc.day] = [];
                dayIncome[inc.day].push(inc);
            }

            // Group bill due dates for this month by day
            const dayBills = {};
            for (const bill of (this.bills || [])) {
                if (!bill.dueDay) continue;
                const daysInM = new Date(year, month + 1, 0).getDate();
                const day = Math.min(bill.dueDay, daysInM);
                if (!dayBills[day]) dayBills[day] = [];
                dayBills[day].push(bill);
            }

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            let gridHTML = `<div class="cal-day-labels">`;
            for (const dl of DAY_LABELS) gridHTML += `<div class="cal-day-label">${dl}</div>`;
            gridHTML += `</div><div class="cal-grid">`;

            for (let i = 0; i < firstDay; i++) {
                gridHTML += `<div class="cal-cell cal-empty"></div>`;
            }

            for (let day = 1; day <= daysInMonth; day++) {
                const events    = dayPayments[day] || [];
                const incomes   = dayIncome[day]   || [];
                const bills     = dayBills[day]    || [];
                const hasEvents = events.length > 0 || incomes.length > 0 || bills.length > 0;
                const isToday   = (year === todayYear && month === todayMonth && day === todayDay);

                gridHTML += `<div class="cal-cell${hasEvents ? ' cal-has-events' : ''}${isToday ? ' cal-today' : ''}">
                    <span class="cal-day-num">${day}</span>`;

                // Debt payment chips
                for (const ev of events) {
                    gridHTML += `<div class="cal-event" style="background:${ev.color};" title="${ev.name}: ${this.formatCurrency(ev.payment)}">
                        <span class="cal-event-name">${ev.name}</span>
                        <span class="cal-event-amount">${this.formatCurrency(ev.payment)}</span>
                    </div>`;
                }

                // Income payday chips
                for (const inc of incomes) {
                    gridHTML += `<div class="cal-income-event" title="💰 ${inc.name}: ${this.formatCurrency(inc.amount)}">
                        <span class="cal-income-name">💰 ${inc.name}</span>
                        <span class="cal-income-amount">${this.formatCurrency(inc.amount)}</span>
                    </div>`;
                }

                // Bill due chips
                for (const bill of bills) {
                    gridHTML += `<div class="cal-bill-event" title="🧾 ${bill.name}: ${this.formatCurrency(bill.amount)}">
                        <span class="cal-bill-name">🧾 ${bill.name}</span>
                        <span class="cal-bill-amount">${this.formatCurrency(bill.amount)}</span>
                    </div>`;
                }

                gridHTML += `</div>`;
            }
            gridHTML += `</div>`;

            const monthBlock = document.createElement('div');
            monthBlock.className = 'cal-month';
            monthBlock.innerHTML = `<h4 class="cal-month-title">${monthLabel}</h4>${gridHTML}`;
            monthsRow.appendChild(monthBlock);
        }

        container.appendChild(monthsRow);

        // Clone pagination at bottom
        const paginationBottom = paginationTop.cloneNode(true);
        container.appendChild(paginationBottom);

        // Wire up all prev/next buttons
        container.querySelectorAll('.cal-prev').forEach(btn => {
            btn.addEventListener('click', () => this.renderCalendarView(page - 1));
        });
        container.querySelectorAll('.cal-next').forEach(btn => {
            btn.addEventListener('click', () => this.renderCalendarView(page + 1));
        });
    }
    /**
     * Render the Strategy Comparison panel inside `#interestComparison`.
     * Runs all four payment strategies with the current debts and monthly
     * payment, then displays a ranked table showing total interest and months
     * for each strategy. If the current strategy is not optimal a savings
     * banner is shown.
     * @param {string} currentStrategy - The strategy key currently selected
     * @param {number} monthlyPayment  - The current total monthly payment
     */
    // ─── Interest Saved Comparison ────────────────────────────────────────────
    displayInterestComparison(currentStrategy, monthlyPayment) {
        const container = document.getElementById('interestComparison');
        if (!container || !monthlyPayment || isNaN(monthlyPayment)) { if (container) container.innerHTML = ''; return; }

        const strategies = [
            { key: 'avalanche',        label: 'Avalanche (Highest Interest First)' },
            { key: 'snowball',         label: 'Snowball (Lowest Balance First)' },
            { key: 'priority-lowest',  label: 'Priority (Low → High)' },
            { key: 'priority-highest', label: 'Priority (High → Low)' },
        ];
        const stimulus = this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0;
        const results = [];
        for (const s of strategies) {
            try {
                const r = DebtCalculator.calculatePaymentPlan(this.debts, monthlyPayment, s.key, stimulus);
                const sm = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
                results.push({ ...s, totalInterest: sm.totalInterest, months: sm.monthsToPayOff, isCurrent: s.key === currentStrategy });
            } catch(e) { /* skip invalid configs */ }
        }
        if (results.length < 2) { container.innerHTML = ''; return; }

        results.sort((a, b) => a.totalInterest - b.totalInterest);
        const best = results[0];
        const current = results.find(r => r.isCurrent) || best;
        const interestSaved = current.totalInterest - best.totalInterest;
        const monthsSaved = current.months - best.months;

        let html = `<div class="interest-comparison"><h4>📊 Strategy Comparison</h4>`;
        if (interestSaved > 0.5) {
            html += `<div class="comparison-banner">Switching to <strong>${best.label}</strong> saves <strong>${this.formatCurrency(interestSaved)}</strong> in interest`;
            if (monthsSaved > 0) html += ` and pays off <strong>${monthsSaved} month${monthsSaved !== 1 ? 's' : ''} sooner</strong>`;
            html += `.</div>`;
        } else {
            html += `<div class="comparison-banner comparison-banner--good">✅ You're already using the most interest-efficient strategy!</div>`;
        }
        html += `<div class="table-wrapper"><table class="comparison-table">
            <thead><tr><th>Strategy</th><th>Total Interest</th><th>Months</th><th>Extra Cost vs. Best</th></tr></thead><tbody>`;
        for (const r of results) {
            const diff = r.totalInterest - best.totalInterest;
            html += `<tr class="${r.isCurrent ? 'comparison-current' : ''}">
                <td>${r.label}
                    ${r.isCurrent ? '<span class="strat-badge strat-badge--current">Current</span>' : ''}
                    ${r.key === best.key ? '<span class="strat-badge strat-badge--best">Best</span>' : ''}
                </td>
                <td>${this.formatCurrency(r.totalInterest)}</td>
                <td>${r.months} mo</td>
                <td>${diff > 0.5 ? `<span class="diff-cost">+${this.formatCurrency(diff)}</span>` : '<span class="diff-best">—</span>'}</td>
            </tr>`;
        }
        html += `</tbody></table></div></div>`;
        container.innerHTML = html;
    }

    /**
     * Render the What-If Simulator panel inside `#whatIfSimulator`.
     * Displays a range slider (0 → min(1000, basePayment)) that lets the user
     * drag an extra monthly payment amount and instantly see the resulting
     * months saved and interest saved compared to the base scenario.
     * @param {number} basePayment - The current calculated monthly payment
     * @param {string} strategy    - The currently selected strategy key
     */
    // ─── What-If Simulator ────────────────────────────────────────────────────
    displayWhatIfSimulator(basePayment, strategy) {
        const container = document.getElementById('whatIfSimulator');
        if (!container || !this.lastSummary) { if (container) container.innerHTML = ''; return; }
        const baseSummary = this.lastSummary;
        const stimulus = this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0;

        // Determine a sensible slider max: 2× base payment or $1000, whichever is smaller
        const sliderMax = Math.min(1000, Math.max(200, Math.round(basePayment)));

        container.innerHTML = `<div class="whatif-panel">
            <h4>🔧 What-If Simulator</h4>
            <p class="whatif-desc">Drag the slider to see how paying extra each month changes your payoff.</p>
            <div class="whatif-slider-row">
                <span class="whatif-slider-label">Extra/mo: <strong id="whatifExtraAmt">${this.formatCurrency(0)}</strong></span>
                <input type="range" id="whatifSlider" min="0" max="${sliderMax}" step="10" value="0">
                <span class="whatif-slider-cap">+${this.formatCurrency(sliderMax)}</span>
            </div>
            <div id="whatifResult"><p class="whatif-hint">Move the slider to simulate a higher payment.</p></div>
        </div>`;

        const slider = document.getElementById('whatifSlider');
        const extraAmtEl = document.getElementById('whatifExtraAmt');
        const resultDiv = document.getElementById('whatifResult');

        slider.addEventListener('input', () => {
            const extra = parseInt(slider.value);
            extraAmtEl.textContent = this.formatCurrency(extra);
            if (extra === 0) {
                resultDiv.innerHTML = `<p class="whatif-hint">Move the slider to simulate a higher payment.</p>`;
                return;
            }
            try {
                const r = DebtCalculator.calculatePaymentPlan(this.debts, basePayment + extra, strategy, stimulus);
                const s = DebtCalculator.generateSummary(r.workingDebts, r.paymentPlan);
                const monthsSaved = Math.max(0, baseSummary.monthsToPayOff - s.monthsToPayOff);
                const interestSaved = Math.max(0, baseSummary.totalInterest - s.totalInterest);
                resultDiv.innerHTML = `<div class="whatif-metrics">
                    <div class="whatif-metric">
                        <div class="whatif-metric-label">New Payoff Date</div>
                        <div class="whatif-metric-val">${DebtCalculator.formatDate(s.payOffDate)}</div>
                    </div>
                    <div class="whatif-metric whatif-metric--good">
                        <div class="whatif-metric-label">Months Saved</div>
                        <div class="whatif-metric-val">${monthsSaved}</div>
                    </div>
                    <div class="whatif-metric whatif-metric--good">
                        <div class="whatif-metric-label">Interest Saved</div>
                        <div class="whatif-metric-val">${this.formatCurrency(interestSaved)}</div>
                    </div>
                    <div class="whatif-metric">
                        <div class="whatif-metric-label">New Total Interest</div>
                        <div class="whatif-metric-val">${this.formatCurrency(s.totalInterest)}</div>
                    </div>
                </div>`;
            } catch(e) {
                resultDiv.innerHTML = `<p class="error-message">${e.message}</p>`;
            }
        });
    }

    /**
     * Open the Update Balance modal for a credit-card debt.
     * Pre-fills the input with the current balance and wires up Confirm/Cancel.
     * On confirmation calls `updateDebtBalance()` which preserves `originalBalance`.
     * @param {number} debtId - ID of the debt whose balance will be updated
     */
    // ─── Update Balance Modal ─────────────────────────────────────────────────
    showUpdateBalanceModal(debtId) {
        const id = typeof debtId === 'string' ? parseInt(debtId, 10) : debtId;
        const debt = this.debts.find(d => Number(d.id) === id);
        if (!debt || debt.debtType === 'fixedAmount') return;
        const modal = document.getElementById('updateBalanceModal');
        if (!modal) return;

        document.getElementById('updateBalanceDebtName').textContent = debt.name;
        document.getElementById('updateBalanceCurrent').textContent = this.formatCurrency(debt.accountBalance);

        const balInput = document.getElementById('updateBalanceInput');
        balInput.value = debt.accountBalance.toFixed(2);

        // Show original minimum payment (first recorded value) and pre-fill with current
        const origMin = debt.originalMinimumPayment ?? debt.minimumPayment ?? 0;
        document.getElementById('updateMinPaymentOriginal').textContent = this.formatCurrency(origMin);
        const minInput = document.getElementById('updateMinPaymentInput');
        minInput.value = (debt.minimumPayment ?? 0).toFixed(2);

        modal.style.display = 'flex';
        setTimeout(() => balInput.focus(), 50);

        const close = () => { modal.style.display = 'none'; };
        document.getElementById('confirmUpdateBalance').onclick = () => {
            const newBal = parseFloat(balInput.value);
            if (isNaN(newBal) || newBal < 0) { alert('Please enter a valid balance (0 or more).'); return; }
            const newMin = parseFloat(minInput.value);
            if (isNaN(newMin) || newMin < 0) { alert('Please enter a valid minimum payment (0 or more).'); return; }
            this.updateDebtBalance(id, newBal, newMin);
            close();
        };
        document.getElementById('cancelUpdateBalanceBtn').onclick = close;
        document.getElementById('cancelUpdateBalance').onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
    }

    /**
     * Apply a new balance to a debt, preserve `originalBalance`, and
     * recalculate the payment plan if one already exists.
     * @param {number} debtId         - ID of the debt to update
     * @param {number} newBalance     - The new current balance (≥ 0)
     * @param {number} [newMinPayment] - Optional new minimum payment; if omitted, existing value is kept
     */
    updateDebtBalance(debtId, newBalance, newMinPayment) {
        const idx = this.debts.findIndex(d => Number(d.id) === Number(debtId));
        if (idx === -1) return;

        // Preserve originalBalance — only update accountBalance
        if (!this.debts[idx].originalBalance) {
            this.debts[idx].originalBalance = this.debts[idx].accountBalance;
        }
        this.debts[idx].accountBalance = newBalance;

        // Preserve originalMinimumPayment on first change, then update minimumPayment
        if (newMinPayment !== undefined) {
            if (this.debts[idx].originalMinimumPayment === undefined) {
                this.debts[idx].originalMinimumPayment = this.debts[idx].minimumPayment ?? 0;
            }
            this.debts[idx].minimumPayment = newMinPayment;
        }
        this.saveToStorage();
        // Recalculate if a plan exists
        try {
            const monthlyPayment = parseFloat(document.getElementById('monthlyPayment').value);
            const strategy = document.getElementById('paymentStrategy').value;
            if (monthlyPayment && !isNaN(monthlyPayment) && monthlyPayment > 0) {
                const result = DebtCalculator.calculatePaymentPlan(
                    this.debts, monthlyPayment, strategy,
                    this.perMonthStimulus && this.perMonthStimulus.length > 0 ? this.perMonthStimulus : 0
                );
                this.lastPaymentPlan = result.paymentPlan;
                this.lastSummary = DebtCalculator.generateSummary(result.workingDebts, result.paymentPlan);
                this.displayPaymentPlan();
            }
        } catch(e) { console.error('Recalc after balance update failed:', e); }
        this.renderDebtsList();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUDGET PAGE — Bills & Expenses
    // ─────────────────────────────────────────────────────────────────────────

    /** Add a new bill from the billForm inputs. */
    addBill() {
        const name = document.getElementById('billName').value.trim();
        const amount = parseFloat(document.getElementById('billAmount').value);
        const dueDay = parseInt(document.getElementById('billDueDay').value) || null;
        const category = document.getElementById('billCategory').value;
        const accountId = parseInt(document.getElementById('billAccount')?.value) || null;
        if (!name || isNaN(amount) || amount < 0) {
            alert('Please enter a valid bill name and amount.');
            return;
        }
        this.bills.push({ id: Date.now(), name, amount, dueDay, category, accountId });
        this.saveToStorage();
        document.getElementById('billForm').reset();
        // Collapse the form after adding
        const billBody = document.getElementById('billFormBody');
        const billToggle = document.getElementById('billFormToggle');
        if (billBody) billBody.hidden = true;
        if (billToggle) { billToggle.setAttribute('aria-expanded', 'false'); billToggle.classList.remove('budget-form-toggle--open'); }
        this.renderBudgetPage();
    }

    /** Delete a bill by id. */
    deleteBill(id) {
        this.bills = this.bills.filter(b => b.id !== id);
        this.saveToStorage();
        this.renderBudgetPage();
    }

    /** Enter inline edit mode for a bill. */
    startEditBill(id) {
        this.editingBillId = id;
        this.renderBudgetPage();
    }

    /** Save inline bill edits. */
    saveEditBill(id) {
        const idx = this.bills.findIndex(b => b.id === id);
        if (idx === -1) return;
        const name      = document.getElementById(`be-name-${id}`).value.trim();
        const amount    = parseFloat(document.getElementById(`be-amount-${id}`).value);
        const dueDay    = parseInt(document.getElementById(`be-dueday-${id}`).value) || null;
        const category  = document.getElementById(`be-cat-${id}`).value;
        const acctEl    = document.getElementById(`be-acct-${id}`);
        const accountId = acctEl?.value ? parseInt(acctEl.value) : null;
        if (!name || isNaN(amount) || amount < 0) { alert('Invalid bill data.'); return; }
        this.bills[idx] = { ...this.bills[idx], name, amount, dueDay, category, accountId };
        this.editingBillId = null;
        this.saveToStorage();
        this.renderBudgetPage();
    }

    /** Cancel bill edit. */
    cancelEditBill() {
        this.editingBillId = null;
        this.renderBudgetPage();
    }

    /** Add a new expense budget from the expenseForm inputs. */
    addExpense() {
        const name = document.getElementById('expenseName').value.trim();
        const budgetAmount = parseFloat(document.getElementById('expenseBudget').value);
        const category = document.getElementById('expenseCategory').value;
        const accountId = parseInt(document.getElementById('expenseAccount')?.value) || null;
        if (!name || isNaN(budgetAmount) || budgetAmount < 0) {
            alert('Please enter a valid expense name and budget amount.');
            return;
        }
        this.expenses.push({ id: Date.now(), name, budgetAmount, category, accountId });
        this.saveToStorage();
        document.getElementById('expenseForm').reset();
        // Collapse the form after adding
        const expBody = document.getElementById('expenseFormBody');
        const expToggle = document.getElementById('expenseFormToggle');
        if (expBody) expBody.hidden = true;
        if (expToggle) { expToggle.setAttribute('aria-expanded', 'false'); expToggle.classList.remove('budget-form-toggle--open'); }
        this.renderBudgetPage();
    }

    /** Delete an expense by id. */
    deleteExpense(id) {
        this.expenses = this.expenses.filter(e => e.id !== id);
        this.saveToStorage();
        this.renderBudgetPage();
    }

    /** Enter inline edit mode for an expense. */
    startEditExpense(id) {
        this.editingExpenseId = id;
        this.renderBudgetPage();
    }

    /** Save inline expense edits. */
    saveEditExpense(id) {
        const idx = this.expenses.findIndex(e => e.id === id);
        if (idx === -1) return;
        const name         = document.getElementById(`ee-name-${id}`).value.trim();
        const budgetAmount = parseFloat(document.getElementById(`ee-amount-${id}`).value);
        const category     = document.getElementById(`ee-cat-${id}`).value;
        const acctEl       = document.getElementById(`ee-acct-${id}`);
        const accountId    = acctEl?.value ? parseInt(acctEl.value) : null;
        if (!name || isNaN(budgetAmount) || budgetAmount < 0) { alert('Invalid expense data.'); return; }
        this.expenses[idx] = { ...this.expenses[idx], name, budgetAmount, category, accountId };
        this.editingExpenseId = null;
        this.saveToStorage();
        this.renderBudgetPage();
    }

    /** Cancel expense edit. */
    cancelEditExpense() {
        this.editingExpenseId = null;
        this.renderBudgetPage();
    }

    /** Render the full Budget page: bill cards, expense cards, cashflow summary. */
    renderBudgetPage() {
        // Destroy any existing cashflow charts so canvases get recreated cleanly
        if (this._cashflowDonutChart) { this._cashflowDonutChart.destroy(); this._cashflowDonutChart = null; }
        if (this._cashflowBarChart)   { this._cashflowBarChart.destroy();   this._cashflowBarChart   = null; }
        this._renderBillList();
        this._renderExpenseList();
        this._renderCashFlowSummary();
    }

    _renderBillList() {
        const container = document.getElementById('billList');
        if (!container) return;
        const BILL_CATS = ['Utilities','Internet / Phone','Insurance','Subscription','Rent / Mortgage','Transport','Other'];
        if (this.bills.length === 0) {
            container.innerHTML = `<p class="empty-budget-msg">No bills added yet.</p>`;
            return;
        }

        const cards = this.bills.map(bill => {
            if (this.editingBillId === bill.id) {
                return `<div class="budget-card budget-card--editing">
                    <div class="budget-edit-grid">
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Name</label>
                            <input type="text" id="be-name-${bill.id}" value="${bill.name.replace(/"/g,'&quot;')}" class="form-control"></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Amount ($)</label>
                            <input type="number" id="be-amount-${bill.id}" value="${bill.amount}" step="0.01" min="0" class="form-control"></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Due Day</label>
                            <input type="number" id="be-dueday-${bill.id}" value="${bill.dueDay || ''}" min="1" max="31" class="form-control" placeholder="—"></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Category</label>
                            <select id="be-cat-${bill.id}" class="form-control">
                                ${BILL_CATS.map(c => `<option value="${c}" ${bill.category===c?'selected':''}>${c}</option>`).join('')}
                            </select></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Account</label>
                            <select id="be-acct-${bill.id}" class="form-control">
                                <option value="">— No account —</option>
                                ${this.accounts.map(a => `<option value="${a.id}" ${bill.accountId===a.id?'selected':''}>${a.name}</option>`).join('')}
                            </select></div>
                    </div>
                    <div class="budget-edit-actions">
                        <button class="btn btn-primary btn-small" onclick="app.saveEditBill(${bill.id})">Save</button>
                        <button class="btn btn-secondary btn-small" onclick="app.cancelEditBill()">Cancel</button>
                    </div>
                </div>`;
            }
            const dueTxt = bill.dueDay ? `Due: ${this.getDayOrdinal(bill.dueDay)}` : 'No due day set';
            return `<div class="budget-card">
                <div class="budget-card-info">
                    <span class="budget-card-name">${bill.name}</span>
                    <span class="budget-card-amount">${this.formatCurrency(bill.amount)}<span class="budget-card-period">/mo</span></span>
                    <span class="budget-card-meta">${bill.category} &bull; ${dueTxt}</span>
                </div>
                <div class="budget-card-actions">
                    <button class="btn-edit" onclick="app.startEditBill(${bill.id})">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="app.deleteBill(${bill.id})">Delete</button>
                </div>
            </div>`;
        }).join('');

        // ── Category breakdown ───────────────────────────────────────────────
        const catMap = {};
        for (const bill of this.bills) {
            const cat = bill.category || 'Other';
            if (!catMap[cat]) catMap[cat] = { count: 0, total: 0 };
            catMap[cat].count++;
            catMap[cat].total += bill.amount;
        }
        const totalBills = this.bills.reduce((s, b) => s + b.amount, 0);
        const catRows = Object.entries(catMap)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([cat, v]) => `
                <div class="budget-cat-row">
                    <span class="budget-cat-name">${cat}</span>
                    <span class="budget-cat-count">${v.count} item${v.count !== 1 ? 's' : ''}</span>
                    <span class="budget-cat-amount">${this.formatCurrency(v.total)}/mo</span>
                </div>`).join('');

        const summaryHTML = `
            <div class="budget-cat-summary">
                <div class="budget-cat-summary-header">
                    <span>Bills by Category</span>
                    <span class="budget-cat-summary-total">${this.formatCurrency(totalBills)}/mo total</span>
                </div>
                ${catRows}
            </div>`;

        container.innerHTML = cards + summaryHTML;
    }

    _renderExpenseList() {
        const container = document.getElementById('expenseList');
        if (!container) return;
        const EXP_CATS = ['Food & Groceries','Dining Out','Health & Fitness','Entertainment','Clothing','Personal Care','Education','Childcare','Other'];
        if (this.expenses.length === 0) {
            container.innerHTML = `<p class="empty-budget-msg">No expense budgets added yet.</p>`;
            return;
        }

        const cards = this.expenses.map(exp => {
            if (this.editingExpenseId === exp.id) {
                return `<div class="budget-card budget-card--editing">
                    <div class="budget-edit-grid">
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Name</label>
                            <input type="text" id="ee-name-${exp.id}" value="${exp.name.replace(/"/g,'&quot;')}" class="form-control"></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Budget ($)</label>
                            <input type="number" id="ee-amount-${exp.id}" value="${exp.budgetAmount}" step="0.01" min="0" class="form-control"></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Category</label>
                            <select id="ee-cat-${exp.id}" class="form-control">
                                ${EXP_CATS.map(c => `<option value="${c}" ${exp.category===c?'selected':''}>${c}</option>`).join('')}
                            </select></div>
                        <div class="form-group" style="margin:0"><label style="font-size:0.8rem;font-weight:600">Account</label>
                            <select id="ee-acct-${exp.id}" class="form-control">
                                <option value="">— No account —</option>
                                ${this.accounts.map(a => `<option value="${a.id}" ${exp.accountId===a.id?'selected':''}>${a.name}</option>`).join('')}
                            </select></div>
                    </div>
                    <div class="budget-edit-actions">
                        <button class="btn btn-primary btn-small" onclick="app.saveEditExpense(${exp.id})">Save</button>
                        <button class="btn btn-secondary btn-small" onclick="app.cancelEditExpense()">Cancel</button>
                    </div>
                </div>`;
            }
            return `<div class="budget-card">
                <div class="budget-card-info">
                    <span class="budget-card-name">${exp.name}</span>
                    <span class="budget-card-amount">${this.formatCurrency(exp.budgetAmount)}<span class="budget-card-period">/mo</span></span>
                    <span class="budget-card-meta">${exp.category}</span>
                </div>
                <div class="budget-card-actions">
                    <button class="btn-edit" onclick="app.startEditExpense(${exp.id})">Edit</button>
                    <button class="btn btn-danger btn-small" onclick="app.deleteExpense(${exp.id})">Delete</button>
                </div>
            </div>`;
        }).join('');

        // ── Category breakdown ───────────────────────────────────────────────
        const catMap = {};
        for (const exp of this.expenses) {
            const cat = exp.category || 'Other';
            if (!catMap[cat]) catMap[cat] = { count: 0, total: 0 };
            catMap[cat].count++;
            catMap[cat].total += exp.budgetAmount;
        }
        const totalExp = this.expenses.reduce((s, e) => s + e.budgetAmount, 0);
        const catRows = Object.entries(catMap)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([cat, v]) => `
                <div class="budget-cat-row budget-cat-row--expense">
                    <span class="budget-cat-name">${cat}</span>
                    <span class="budget-cat-count">${v.count} item${v.count !== 1 ? 's' : ''}</span>
                    <span class="budget-cat-amount">${this.formatCurrency(v.total)}/mo</span>
                </div>`).join('');

        const summaryHTML = `
            <div class="budget-cat-summary budget-cat-summary--expense">
                <div class="budget-cat-summary-header">
                    <span>Expenses by Category</span>
                    <span class="budget-cat-summary-total">${this.formatCurrency(totalExp)}/mo total</span>
                </div>
                ${catRows}
            </div>`;

        container.innerHTML = cards + summaryHTML;
    }

    _renderCashFlowSummary() {
        const el = document.getElementById('cashFlowSummary');
        if (!el) return;

        const { monthlyTotal: monthlyIncome } = this.computeMonthlyIncome();
        const totalBills = this.bills.reduce((s, b) => s + b.amount, 0);
        const totalExpenses = this.expenses.reduce((s, e) => s + e.budgetAmount, 0);
        const totalDebtMin = this.debts.reduce((s, d) => s + (d.minimumPayment || 0), 0);
        const totalOutflow = totalBills + totalExpenses + totalDebtMin;
        const net = monthlyIncome - totalOutflow;
        const netClass = net >= 0 ? 'cashflow-net--positive' : 'cashflow-net--negative';

        if (monthlyIncome === 0 && totalOutflow === 0) { el.style.display = 'none'; return; }
        el.style.display = 'block';

        const row = (label, value, cls = '') =>
            `<div class="cashflow-row ${cls}"><span class="cashflow-label">${label}</span><span class="cashflow-value">${this.formatCurrency(value)}</span></div>`;

        const subRow = (label, value, cls = '') =>
            `<div class="cashflow-subrow ${cls}"><span class="cashflow-sublabel">${label}</span><span class="cashflow-subvalue">${this.formatCurrency(value)}</span></div>`;

        // ── Bills by category ────────────────────────────────────────────────
        let billCatRows = '';
        if (totalBills > 0) {
            const billCats = {};
            for (const b of this.bills) {
                const cat = b.category || 'Other';
                billCats[cat] = (billCats[cat] || 0) + b.amount;
            }
            billCatRows = Object.entries(billCats)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt]) => subRow(cat, amt, 'cashflow-subrow--bill'))
                .join('');
        }

        // ── Expenses by category ─────────────────────────────────────────────
        let expCatRows = '';
        if (totalExpenses > 0) {
            const expCats = {};
            for (const e of this.expenses) {
                const cat = e.category || 'Other';
                expCats[cat] = (expCats[cat] || 0) + e.budgetAmount;
            }
            expCatRows = Object.entries(expCats)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt]) => subRow(cat, amt, 'cashflow-subrow--expense'))
                .join('');
        }

        // ── Debt minimums by debt name ────────────────────────────────────────
        let debtSubRows = '';
        if (totalDebtMin > 0) {
            debtSubRows = this.debts
                .filter(d => (d.minimumPayment || 0) > 0)
                .sort((a, b) => (b.minimumPayment || 0) - (a.minimumPayment || 0))
                .map(d => subRow(d.name, d.minimumPayment, 'cashflow-subrow--debt'))
                .join('');
        }

        el.innerHTML = `
            <div class="cashflow-tab-bar">
                <button class="cashflow-tab cashflow-tab--active" data-tab="summary">📋 Summary</button>
                <button class="cashflow-tab" data-tab="charts">📊 Charts</button>
            </div>

            <div class="cashflow-tab-panel cashflow-tab-panel--active" id="cashflowPanelSummary">
                <h4>📈 Monthly Cash Flow</h4>
                <div class="cashflow-grid">
                    <div class="cashflow-inflow">
                        <div class="cashflow-section-title">Income</div>
                        ${row('Expected this month', monthlyIncome, 'cashflow-row--income')}
                    </div>
                    <div class="cashflow-outflow">
                        <div class="cashflow-section-title">Outflows</div>
                        ${totalDebtMin > 0 ? row('Debt minimums', totalDebtMin, 'cashflow-row--debt') + debtSubRows : ''}
                        ${totalBills > 0 ? row('Bills', totalBills, 'cashflow-row--bills') + billCatRows : ''}
                        ${totalExpenses > 0 ? row('Budgeted expenses', totalExpenses, 'cashflow-row--expenses') + expCatRows : ''}
                        ${row('Total outflow', totalOutflow, 'cashflow-row--total')}
                    </div>
                </div>
                <div class="cashflow-net ${netClass}">
                    <span>Net remaining</span>
                    <span>${this.formatCurrency(net)}</span>
                </div>
            </div>

            <div class="cashflow-tab-panel" id="cashflowPanelCharts">
                <div class="cashflow-charts-top">
                    <div class="cashflow-chart-wrap cashflow-chart-wrap--donut">
                        <h5 class="cashflow-chart-title">Where Does My Money Go?</h5>
                        <p class="cashflow-chart-sub">Monthly income allocation</p>
                        <canvas id="cashflowDonutChart"></canvas>
                    </div>
                </div>
                <div class="cashflow-charts-bottom">
                    <div class="cashflow-chart-wrap cashflow-chart-wrap--bar">
                        <h5 class="cashflow-chart-title">Outflow Breakdown</h5>
                        <p class="cashflow-chart-sub">Amount per category / debt</p>
                        <div class="cashflow-bar-container">
                            <canvas id="cashflowBarChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>`;

        // Tab switching
        el.querySelectorAll('.cashflow-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.cashflow-tab').forEach(b => b.classList.remove('cashflow-tab--active'));
                el.querySelectorAll('.cashflow-tab-panel').forEach(p => p.classList.remove('cashflow-tab-panel--active'));
                btn.classList.add('cashflow-tab--active');
                el.querySelector(`#cashflowPanel${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`).classList.add('cashflow-tab-panel--active');
                if (btn.dataset.tab === 'charts') this._renderCashFlowCharts(monthlyIncome, totalDebtMin, totalBills, totalExpenses, net);
            });
        });
    }

    _renderCashFlowCharts(monthlyIncome, totalDebtMin, totalBills, totalExpenses, net) {
        // ── Donut: income allocation (outflow + net) ──────────────────────────
        const donutCanvas = document.getElementById('cashflowDonutChart');
        if (donutCanvas) {
            if (this._cashflowDonutChart) { this._cashflowDonutChart.destroy(); this._cashflowDonutChart = null; }
            const donutData = [];
            const donutLabels = [];
            const donutColors = [];
            if (totalDebtMin > 0) { donutData.push(totalDebtMin); donutLabels.push('Debt Minimums'); donutColors.push('#ef4444'); }
            if (totalBills > 0)   { donutData.push(totalBills);   donutLabels.push('Bills');          donutColors.push('#f59e0b'); }
            if (totalExpenses > 0){ donutData.push(totalExpenses);donutLabels.push('Expenses');        donutColors.push('#8b5cf6'); }
            if (net > 0)          { donutData.push(net);          donutLabels.push('Net Remaining');   donutColors.push('#10b981'); }
            else if (donutData.length === 0) return;

            this._cashflowDonutChart = new Chart(donutCanvas, {
                type: 'doughnut',
                data: { labels: donutLabels, datasets: [{ data: donutData, backgroundColor: donutColors, borderWidth: 2, borderColor: '#fff' }] },
                options: {
                    responsive: true, maintainAspectRatio: true,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, font: { size: 12 } } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${this.formatCurrency(ctx.parsed)}` } }
                    }
                }
            });
        }

        // ── Bar: outflow categories (bills by category + expenses by category + debt per debt) ──
        const barCanvas = document.getElementById('cashflowBarChart');
        if (barCanvas) {
            if (this._cashflowBarChart) { this._cashflowBarChart.destroy(); this._cashflowBarChart = null; }

            const labels = [];
            const values = [];
            const colors = [];

            // Debt minimums per debt
            this.debts.filter(d => (d.minimumPayment || 0) > 0)
                .sort((a, b) => (b.minimumPayment || 0) - (a.minimumPayment || 0))
                .forEach(d => { labels.push(d.name); values.push(d.minimumPayment); colors.push('#ef4444'); });

            // Bills by category
            const billCats = {};
            for (const b of this.bills) { const c = b.category || 'Other'; billCats[c] = (billCats[c] || 0) + b.amount; }
            Object.entries(billCats).sort((a, b) => b[1] - a[1])
                .forEach(([cat, amt]) => { labels.push(cat); values.push(amt); colors.push('#f59e0b'); });

            // Expenses by category
            const expCats = {};
            for (const e of this.expenses) { const c = e.category || 'Other'; expCats[c] = (expCats[c] || 0) + e.budgetAmount; }
            Object.entries(expCats).sort((a, b) => b[1] - a[1])
                .forEach(([cat, amt]) => { labels.push(cat); values.push(amt); colors.push('#8b5cf6'); });

            if (labels.length === 0) return;

            this._cashflowBarChart = new Chart(barCanvas, {
                type: 'bar',
                data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => ` ${this.formatCurrency(ctx.parsed.y)}/mo` } }
                    },
                    scales: {
                        x: { ticks: { font: { size: 11 }, maxRotation: 35, minRotation: 20 } },
                        y: { ticks: { callback: v => this.formatCurrency(v) }, grid: { color: 'rgba(0,0,0,0.06)' }, beginAtZero: true }
                    }
                }
            });
        }
    }

    /**
     * Draw (or redraw) the "Payoff Timeline" Chart.js line chart.
     * One line per debt, each showing the projected balance declining to zero.
     * Uses `this.lastPaymentPlan` as the data source. Destroys any previous
     * `this.balanceChart` instance before creating a new one.
     */
    renderBalanceChart() {
        if (!this.lastPaymentPlan) return;

        const months = [];
        const debtBalances = {};
        const debtNames = [];
        const debtNameSet = new Set();
        const palette = [
            '#2563eb','#dc2626','#059669','#d97706','#7c3aed',
            '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
        ];

        // Collect all debt names in payment order
        for (const monthData of this.lastPaymentPlan) {
            for (const payment of monthData.payments) {
                if (!debtNameSet.has(payment.debtName)) {
                    debtNames.push(payment.debtName);
                    debtNameSet.add(payment.debtName);
                    debtBalances[payment.debtName] = [];
                }
            }
        }

        // Build per-month per-debt balance arrays
        for (const monthData of this.lastPaymentPlan) {
            months.push(DebtCalculator.getMonthName(monthData.month - 1));
            const paymentMap = {};
            for (const payment of monthData.payments) {
                paymentMap[payment.debtName] = payment.balance;
            }
            for (const name of debtNames) {
                debtBalances[name].push(paymentMap[name] !== undefined ? paymentMap[name] : 0);
            }
        }

        const datasets = debtNames.map((name, i) => ({
            label: name,
            data: debtBalances[name],
            borderColor: palette[i % palette.length],
            backgroundColor: palette[i % palette.length] + '22',
            fill: false,
            tension: 0.4,
            pointRadius: 1,
            pointHoverRadius: 4,
        }));

        const ctx = document.getElementById('balanceChart').getContext('2d');
        if (this.balanceChart) this.balanceChart.destroy();
        this.balanceChart = new Chart(ctx, {
            type: 'line',
            data: { labels: months, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                    title: { display: true, text: 'Payoff Timeline — Balance per Debt', font: { size: 13 } },
                    tooltip: {
                        mode: 'index', intersect: false,
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: v => '$' + v.toLocaleString() },
                        title: { display: true, text: 'Balance ($)' }
                    },
                    x: { title: { display: true, text: 'Month' } }
                }
            }
        });
    }

    /**
     * Draw (or redraw) the "Total Interest vs. Principal Paid" doughnut chart.
     * Uses `this.lastSummary.totalDebt` (principal) and
     * `this.lastSummary.totalInterest` as segment values. Destroys any
     * previous `this.pieChart` instance before creating a new one.
     */
    renderPieChart() {
        const canvas = document.getElementById('pieChart');
        if (!canvas || !this.lastSummary) return;
        const principal = this.lastSummary.totalDebt;
        const interest = this.lastSummary.totalInterest;
        if (this.pieChart) this.pieChart.destroy();
        this.pieChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Principal (Debt)', 'Total Interest'],
                datasets: [{
                    data: [parseFloat(principal.toFixed(2)), parseFloat(interest.toFixed(2))],
                    backgroundColor: ['#059669', '#dc2626'],
                    borderColor: ['#fff', '#fff'],
                    borderWidth: 3,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 14, font: { size: 12 } } },
                    title: { display: true, text: 'Total Interest vs. Principal Paid', font: { size: 13 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                                return `${ctx.label}: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Draw (or redraw) the cumulative-payments progress line chart.
     * Three lines: Total Paid, Principal Paid, and Interest Paid — all
     * running totals over the plan duration. Destroys any previous
     * `this.progressChart` instance.
     */
    renderProgressChart() {
        if (!this.lastPaymentPlan) return;

        const months = [];
        const totalPaid = [];
        const principalPaid = [];
        const interestPaid = [];

        let runningTotal = 0;
        let runningPrincipal = 0;
        let runningInterest = 0;

        for (const monthData of this.lastPaymentPlan) {
            const monthName = DebtCalculator.getMonthName(monthData.month - 1);
            months.push(monthName);

            let monthPrincipal = 0;
            let monthInterest = 0;
            let monthTotal = 0;
            for (const payment of monthData.payments) {
                monthPrincipal += payment.principal;
                monthInterest += payment.interest;
                monthTotal += payment.payment;
            }
            runningTotal += monthTotal;
            runningPrincipal += monthPrincipal;
            runningInterest += monthInterest;
            totalPaid.push(runningTotal);
            principalPaid.push(runningPrincipal);
            interestPaid.push(runningInterest);
        }

        const ctx = document.getElementById('progressChart').getContext('2d');
        if (this.progressChart) {
            this.progressChart.destroy();
        }
        this.progressChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    {
                        label: 'Total Paid',
                        data: totalPaid,
                        borderColor: '#2563eb',
                        backgroundColor: '#2563eb20',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Principal Paid',
                        data: principalPaid,
                        borderColor: '#059669',
                        backgroundColor: '#05966920',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Interest Paid',
                        data: interestPaid,
                        borderColor: '#dc2626',
                        backgroundColor: '#dc262620',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                label += new Intl.NumberFormat('en-US', {
                                    style: 'currency',
                                    currency: 'USD'
                                }).format(context.parsed.y);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        },
                        title: {
                            display: true,
                            text: 'Amount ($)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Month'
                        }
                    }
                }
            }
        });
    }

    /**
     * Pie chart: current balance distribution across all debts.
     */
    renderDebtDistributionChart() {
        const canvas = document.getElementById('debtDistributionChart');
        if (!canvas || !this.debts || this.debts.length === 0) return;

        if (this.debtDistributionChart) this.debtDistributionChart.destroy();

        // Use the first month of the payment plan for per-debt monthly amounts.
        // Fall back to minimum payments if no plan has been run yet.
        const palette = [
            '#2563eb','#dc2626','#d97706','#7c3aed',
            '#db2777','#0891b2','#65a30d','#ea580c','#6366f1','#0d9488'
        ];

        let labels, data;
        if (this.lastPaymentPlan && this.lastPaymentPlan.length > 0) {
            const firstMonth = this.lastPaymentPlan[0];
            labels = [];
            data   = [];
            for (const p of firstMonth.payments) {
                if (p.payment > 0) {
                    labels.push(p.debtName);
                    data.push(parseFloat(p.payment.toFixed(2)));
                }
            }
        } else {
            labels = this.debts.map(d => d.name);
            data   = this.debts.map(d => parseFloat((d.minimumPayment || 0).toFixed(2)));
        }

        if (data.length === 0) return;

        const colors = labels.map((_, i) => palette[i % palette.length]);
        const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
        const total = data.reduce((a, b) => a + b, 0);

        this.debtDistributionChart = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: '#fff',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                    title: { display: true, text: 'Monthly Payment Distribution', font: { size: 13 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                                return `${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Pie chart: monthly debt payment vs. remaining income.
     * Only rendered when income sources exist.
     */
    renderDebtToIncomeChart() {
        const canvas = document.getElementById('debtToIncomeChart');
        if (!canvas) return;

        if (this.debtToIncomeChart) this.debtToIncomeChart.destroy();

        const { monthlyTotal } = this.computeMonthlyIncome();
        // Read the monthly payment from the DOM input (it is never stored as an instance property)
        const monthlyPayment = parseFloat(document.getElementById('monthlyPayment')?.value) || 0;

        if (monthlyTotal <= 0 || (this.incomes || []).length === 0) {
            // No income data — draw a placeholder message
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#6b7280';
            ctx.font = '13px sans-serif';
            ctx.fillText('Add income sources to see debt-to-income ratio', canvas.width / 2, canvas.height / 2);
            ctx.restore();
            return;
        }

        const debtPmt   = Math.min(monthlyPayment, monthlyTotal);
        const remaining = Math.max(0, monthlyTotal - debtPmt);

        const fmt = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

        this.debtToIncomeChart = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: ['Debt Payments', 'Remaining Income'],
                datasets: [{
                    data: [parseFloat(debtPmt.toFixed(2)), parseFloat(remaining.toFixed(2))],
                    backgroundColor: ['#dc2626', '#059669'],
                    borderColor: '#fff',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
                    title: { display: true, text: 'Monthly Debt-to-Income', font: { size: 13 } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
                                return `${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ACCOUNTS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Refresh all account-selector <select> dropdowns in the Add-forms so
     * they always reflect the current `this.accounts` list.
     * Call this after any change to `this.accounts`.
     */
    _refreshAccountSelectors() {
        const selIds = ['incomeAccount','bonusAccount','billAccount','expenseAccount','debtAccount'];
        const opts = [
            `<option value="">— No account —</option>`,
            ...this.accounts.map(a => `<option value="${a.id}">${a.name} (${a.type})</option>`)
        ].join('');
        for (const id of selIds) {
            const el = document.getElementById(id);
            if (!el) continue;
            const prev = el.value;
            el.innerHTML = opts;
            // restore selection if the account still exists
            if (this.accounts.find(a => String(a.id) === prev)) el.value = prev;
        }
    }

    /** Add a new account from the accountForm inputs. */
    addAccount() {
        const name = document.getElementById('accountName').value.trim();
        const type = document.getElementById('accountType').value;
        const startingBalance = parseFloat(document.getElementById('accountStartingBalance').value);

        if (!name) { alert('Please enter an account name.'); return; }
        if (isNaN(startingBalance)) { alert('Please enter a starting balance (use 0 if unknown).'); return; }

        this.accounts.push({ id: Date.now(), name, type, startingBalance });
        this.saveToStorage();
        this.renderAccountsList();
        this._refreshAccountSelectors();
        document.getElementById('accountForm').reset();
    }

    /** Delete an account by ID. */
    deleteAccount(id) {
        this.accounts = this.accounts.filter(a => a.id !== id);
        this.saveToStorage();
        this.renderAccountsList();
        this._refreshAccountSelectors();
    }

    /** Enter inline-edit mode for an account card. */
    startEditAccount(id) {
        this.editingAccountId = id;
        this.renderAccountsList();
        setTimeout(() => { const el = document.getElementById(`ac-name-${id}`); if (el) el.focus(); }, 0);
    }

    /** Cancel inline-edit for an account card. */
    cancelEditAccount() {
        this.editingAccountId = null;
        this.renderAccountsList();
    }

    /** Save inline-edit for an account card. */
    saveEditAccount(id) {
        const idx = this.accounts.findIndex(a => a.id === id);
        if (idx === -1) return;
        const name = document.getElementById(`ac-name-${id}`)?.value.trim();
        const type = document.getElementById(`ac-type-${id}`)?.value;
        const startingBalance = parseFloat(document.getElementById(`ac-bal-${id}`)?.value);
        if (!name) { alert('Please enter an account name.'); return; }
        if (isNaN(startingBalance)) { alert('Please enter a valid starting balance.'); return; }
        this.accounts[idx] = { ...this.accounts[idx], name, type, startingBalance };
        this.editingAccountId = null;
        this.saveToStorage();
        this.renderAccountsList();
        this._refreshAccountSelectors();
    }

    /**
     * Compute the projected balance for a given account based on:
     *   startingBalance
     *   + income paydays this month assigned to this account
     *   + bonuses this month assigned to this account
     *   − debt minimums assigned to this account
     *   − bills assigned to this account
     *   − expense budgets assigned to this account
     * @param {number|null} accountId
     * @returns {number}
     */
    computeAccountBalance(accountId, year = null, month = null) {
        const acct = this.accounts.find(a => a.id === accountId);
        if (!acct) return 0;
        let balance = acct.startingBalance;

        // Default to current month if not specified
        const now = new Date();
        const yr = year  !== null ? year  : now.getFullYear();
        const mo = month !== null ? month : now.getMonth();

        // Add income paydays in the specified month
        for (const inc of this.incomes) {
            if (inc.accountId === accountId) {
                balance += inc.amount * this._incomeDaysInMonth(inc, yr, mo).length;
            }
        }

        // Add bonuses in the specified month
        for (const b of this.bonuses) {
            if (b.accountId !== accountId) continue;
            const bd = new Date(b.date + 'T12:00:00');
            if (bd.getFullYear() === yr && bd.getMonth() === mo) balance += b.amount;
        }

        // Subtract debt minimums
        for (const d of this.debts) {
            if (d.accountId === accountId) balance -= (d.minimumPayment || 0);
        }

        // Subtract bills
        for (const b of this.bills) {
            if (b.accountId === accountId) balance -= b.amount;
        }

        // Subtract expense budgets
        for (const e of this.expenses) {
            if (e.accountId === accountId) balance -= e.budgetAmount;
        }

        return balance;
    }

    /** Render the full accounts list on the Accounts page. */
    renderAccountsList() {
        const container = document.getElementById('accountList');
        if (!container) return;

        if (!this.accounts || this.accounts.length === 0) {
            container.innerHTML = `<p class="acct-empty-msg">No accounts yet. Add your first account above to start tracking cash flow per account.</p>`;
            return;
        }

        const ACCT_TYPES = ['Checking','Savings','Cash','Investment','Credit Card','Loan','Other'];
        const typeIcon = { Checking:'🏦', Savings:'💰', Cash:'💵', Investment:'📈', 'Credit Card':'💳', Loan:'🏠', Other:'🗂️' };

        const now = new Date();
        const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const cards = this.accounts.map(a => {
            if (this.editingAccountId === a.id) {
                return `<div class="acct-card acct-card--editing">
                    <div class="acct-edit-grid">
                        <div class="form-group" style="margin:0">
                            <label style="font-size:0.8rem;font-weight:600">Name</label>
                            <input type="text" id="ac-name-${a.id}" value="${a.name.replace(/"/g,'&quot;')}" style="width:100%">
                        </div>
                        <div class="form-group" style="margin:0">
                            <label style="font-size:0.8rem;font-weight:600">Type</label>
                            <select id="ac-type-${a.id}" style="width:100%">
                                ${ACCT_TYPES.map(t => `<option value="${t}" ${a.type===t?'selected':''}>${t}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group" style="margin:0">
                            <label style="font-size:0.8rem;font-weight:600">Starting Balance ($)</label>
                            <input type="number" id="ac-bal-${a.id}" value="${a.startingBalance}" step="0.01" style="width:100%">
                        </div>
                    </div>
                    <div class="acct-edit-actions">
                        <button class="btn btn-primary btn-small" onclick="app.saveEditAccount(${a.id})">Save</button>
                        <button class="btn btn-secondary btn-small" onclick="app.cancelEditAccount()">Cancel</button>
                    </div>
                </div>`;
            }

            const projBalance = this.computeAccountBalance(a.id);
            const balClass = projBalance >= 0 ? 'acct-balance--pos' : 'acct-balance--neg';

            // Items linked to this account
            const linkedIncome  = this.incomes.filter(i => i.accountId === a.id);
            const linkedBonuses = this.bonuses.filter(b => b.accountId === a.id);
            const linkedDebts   = this.debts.filter(d => d.accountId === a.id);
            const linkedBills   = this.bills.filter(b => b.accountId === a.id);
            const linkedExp     = this.expenses.filter(e => e.accountId === a.id);
            const hasLinks = linkedIncome.length || linkedBonuses.length || linkedDebts.length || linkedBills.length || linkedExp.length;

            const linkRows = !hasLinks ? '' : `
                <div class="acct-links">
                    ${linkedIncome.map(i  => `<span class="acct-link acct-link--income">💰 ${i.name}</span>`).join('')}
                    ${linkedBonuses.map(b => `<span class="acct-link acct-link--bonus">🎁 ${b.name}</span>`).join('')}
                    ${linkedDebts.map(d   => `<span class="acct-link acct-link--debt">💳 ${d.name}</span>`).join('')}
                    ${linkedBills.map(b   => `<span class="acct-link acct-link--bill">🧾 ${b.name}</span>`).join('')}
                    ${linkedExp.map(e     => `<span class="acct-link acct-link--exp">💸 ${e.name}</span>`).join('')}
                </div>`;

            return `<div class="acct-card">
                <div class="acct-card-header">
                    <span class="acct-type-icon">${typeIcon[a.type] || '🗂️'}</span>
                    <div class="acct-card-info">
                        <span class="acct-card-name">${a.name}</span>
                        <span class="acct-type-badge">${a.type}</span>
                    </div>
                    <div class="acct-balances">
                        <div class="acct-balance-item">
                            <span class="acct-balance-label">Starting</span>
                            <span class="acct-balance-value">${this.formatCurrency(a.startingBalance)}</span>
                        </div>
                        <div class="acct-balance-item">
                            <span class="acct-balance-label">Proj. (${monthLabel})</span>
                            <span class="acct-balance-value ${balClass}">${this.formatCurrency(projBalance)}</span>
                        </div>
                    </div>
                    <div class="debt-actions">
                        <button class="btn-edit" onclick="app.startEditAccount(${a.id})">Edit</button>
                        <button class="btn btn-danger btn-small" onclick="app.deleteAccount(${a.id})">Delete</button>
                    </div>
                </div>
                ${linkRows}
            </div>`;
        }).join('');

        container.innerHTML = cards;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  REPORTS PAGE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Helper — returns the day-of-month numbers when `inc` is paid in the
     * given year/month (mirrors paydaysInCurrentMonth but returns an array
     * of day numbers rather than a count).
     */
    _incomeDaysInMonth(inc, year, month) {
        const monthStart = new Date(year, month, 1);
        const monthEnd   = new Date(year, month + 1, 0);
        const msPerDay   = 24 * 60 * 60 * 1000;
        const first = new Date(inc.firstPayDate + 'T12:00:00');
        if (isNaN(first.getTime())) return [];
        const days = [];
        if (inc.frequency === 'biweekly') {
            let pay = new Date(first);
            const diffDays = Math.floor((monthStart - pay) / msPerDay);
            const periods  = Math.floor(diffDays / 14);
            pay = new Date(pay.getTime() + Math.max(0, periods) * 14 * msPerDay);
            while (pay < monthStart) pay = new Date(pay.getTime() + 14 * msPerDay);
            while (pay <= monthEnd) {
                days.push(pay.getDate());
                pay = new Date(pay.getTime() + 14 * msPerDay);
            }
        } else {
            const payDay = first.getDate();
            const daysInM = new Date(year, month + 1, 0).getDate();
            const actualDay = Math.min(payDay, daysInM);
            const candidate = new Date(year, month, actualDay);
            if (candidate >= monthStart && candidate <= monthEnd) days.push(actualDay);
        }
        return days;
    }

    /**
     * Entry point — renders all three report panels for the current month.
     * Called when the user switches to the Reports page.
     */
    // ══════════════════════════════════════════════════════════════════════════
    // REPORTS PAGE
    // ══════════════════════════════════════════════════════════════════════════

    /** Returns a Date object for the first day of the currently selected report month. */
    _getReportDate() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + this._reportMonthOffset, 1);
    }

    /** Step the report month back by 1 and re-render. */
    prevReportMonth() {
        this._reportMonthOffset--;
        this._updateReportMonthNav();
        this.renderReportsPage();
    }

    /** Step the report month forward by 1 and re-render. */
    nextReportMonth() {
        this._reportMonthOffset++;
        this._updateReportMonthNav();
        this.renderReportsPage();
    }

    /** Update the month label and disable the "next" button if already at current month. */
    _updateReportMonthNav() {
        const d = this._getReportDate();
        const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const el = document.getElementById('rptMonthLabel');
        if (el) el.textContent = label;
        // Optionally dim the "prev" button if too far back (> 24 months)
        const prevBtn = document.getElementById('rptPrevMonth');
        if (prevBtn) prevBtn.disabled = this._reportMonthOffset <= -24;
    }

    renderReportsPage() {
        // Destroy any lingering chart instances
        ['_rptIncomeChart', '_rptBillsChart', '_rptExpChart', '_rptMoneyFlowChart']
            .forEach(k => { if (this[k]) { this[k].destroy(); this[k] = null; } });

        this._renderReportsCalendar();
        this._renderReportsIncomeExp();
        this._renderReportsMoneyFlow();
    }

    // ── Calendar ────────────────────────────────────────────────────────────
    /** Renders a standalone current-month calendar with all events. */
    _renderReportsCalendar() {
        const container = document.getElementById('reportsCalendar');
        if (!container) return;
        container.innerHTML = '';

        const rptDate  = this._getReportDate();
        const year     = rptDate.getFullYear();
        const month    = rptDate.getMonth();
        const now      = new Date();
        const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
        const today    = isCurrentMonth ? now.getDate() : -1;

        const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

        // ── Build event maps keyed by day-of-month ──────────────────────────

        // Income paydays
        const dayIncome = {};
        for (const inc of (this.incomes || [])) {
            for (const d of this._incomeDaysInMonth(inc, year, month)) {
                if (!dayIncome[d]) dayIncome[d] = [];
                dayIncome[d].push(inc);
            }
        }

        // Bills due
        const dayBills = {};
        for (const bill of (this.bills || [])) {
            if (!bill.dueDay) continue;
            const daysInM = new Date(year, month + 1, 0).getDate();
            const d = Math.min(bill.dueDay, daysInM);
            if (!dayBills[d]) dayBills[d] = [];
            dayBills[d].push(bill);
        }

        // Debt payments due
        const dayDebts = {};
        const palette = ['#2563eb','#dc2626','#d97706','#7c3aed','#db2777','#0891b2','#65a30d','#ea580c','#6366f1'];
        let ci = 0;
        for (const debt of (this.debts || [])) {
            const daysInM = new Date(year, month + 1, 0).getDate();
            const d = Math.min(debt.dueDate || 1, daysInM);
            if (!dayDebts[d]) dayDebts[d] = [];
            dayDebts[d].push({ ...debt, _color: palette[ci++ % palette.length] });
        }

        // Bonuses
        const dayBonuses = {};
        for (const b of (this.bonuses || [])) {
            if (!b.date) continue;
            const bd = new Date(b.date + 'T12:00:00');
            if (bd.getFullYear() === year && bd.getMonth() === month) {
                const d = bd.getDate();
                if (!dayBonuses[d]) dayBonuses[d] = [];
                dayBonuses[d].push(b);
            }
        }

        // ── Legend ──────────────────────────────────────────────────────────
        const legendItems = [
            `<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--income"></span>Payday</span>`,
            `<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bill"></span>Bill due</span>`,
            `<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch" style="background:#2563eb;"></span>Debt payment</span>`,
            `<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--bonus"></span>Bonus/Windfall</span>`,
            isCurrentMonth ? `<span class="rpt-cal-legend-item"><span class="rpt-cal-swatch rpt-cal-swatch--today"></span>Today</span>` : '',
        ].filter(Boolean);

        // ── Grid ────────────────────────────────────────────────────────────
        const firstDay   = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let gridHTML = `<div class="rpt-cal-day-labels">`;
        for (const dl of DAY_LABELS) gridHTML += `<div class="rpt-cal-day-label">${dl}</div>`;
        gridHTML += `</div><div class="rpt-cal-grid">`;

        for (let i = 0; i < firstDay; i++) {
            gridHTML += `<div class="rpt-cal-cell rpt-cal-empty"></div>`;
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const incomes  = dayIncome[day]  || [];
            const bills    = dayBills[day]   || [];
            const debts    = dayDebts[day]   || [];
            const bonuses  = dayBonuses[day] || [];
            const hasEvts  = incomes.length || bills.length || debts.length || bonuses.length;
            const isToday  = day === today;

            gridHTML += `<div class="rpt-cal-cell${hasEvts ? ' rpt-cal-has-events' : ''}${isToday ? ' rpt-cal-today' : ''}">
                <span class="rpt-cal-day-num">${day}</span>`;

            for (const inc of incomes) {
                gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--income" title="💰 ${inc.name}: ${this.formatCurrency(inc.amount)}">
                    <span class="rpt-cal-evt-name">💰 ${inc.name}</span>
                    <span class="rpt-cal-evt-amt">${this.formatCurrency(inc.amount)}</span>
                </div>`;
            }
            for (const bill of bills) {
                gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bill" title="🧾 ${bill.name}: ${this.formatCurrency(bill.amount)}">
                    <span class="rpt-cal-evt-name">🧾 ${bill.name}</span>
                    <span class="rpt-cal-evt-amt">${this.formatCurrency(bill.amount)}</span>
                </div>`;
            }
            for (const debt of debts) {
                gridHTML += `<div class="rpt-cal-evt" style="background:${debt._color}" title="💳 ${debt.name}: min ${this.formatCurrency(debt.minimumPayment)}">
                    <span class="rpt-cal-evt-name">💳 ${debt.name}</span>
                    <span class="rpt-cal-evt-amt">${this.formatCurrency(debt.minimumPayment)}</span>
                </div>`;
            }
            for (const b of bonuses) {
                gridHTML += `<div class="rpt-cal-evt rpt-cal-evt--bonus" title="🎁 ${b.name}: ${this.formatCurrency(b.amount)}">
                    <span class="rpt-cal-evt-name">🎁 ${b.name}</span>
                    <span class="rpt-cal-evt-amt">${this.formatCurrency(b.amount)}</span>
                </div>`;
            }

            gridHTML += `</div>`;
        }
        gridHTML += `</div>`;

        container.innerHTML = `
            <h3 class="rpt-cal-month-title">${monthLabel}</h3>
            <div class="rpt-cal-legend">${legendItems.join('')}</div>
            ${gridHTML}`;
    }

    // ── Income vs Expenses ──────────────────────────────────────────────────
    _renderReportsIncomeExp() {
        const container = document.getElementById('reportsIncomeExp');
        if (!container) return;

        const rptDate = this._getReportDate();
        const rptYear  = rptDate.getFullYear();
        const rptMonth = rptDate.getMonth();

        // Compute income for the report month
        let totalIncome = 0;
        for (const inc of (this.incomes || [])) {
            totalIncome += inc.amount * this._incomeDaysInMonth(inc, rptYear, rptMonth).length;
        }
        for (const b of (this.bonuses || [])) {
            if (!b.date) continue;
            const bd = new Date(b.date + 'T12:00:00');
            if (bd.getFullYear() === rptYear && bd.getMonth() === rptMonth) totalIncome += b.amount;
        }

        const totalBills    = (this.bills    || []).reduce((s, b) => s + b.amount, 0);
        const totalExpenses = (this.expenses || []).reduce((s, e) => s + e.budgetAmount, 0);
        const totalDebtMin  = (this.debts    || []).reduce((s, d) => s + (d.minimumPayment || 0), 0);
        const totalOutflow  = totalBills + totalExpenses + totalDebtMin;
        const net           = totalIncome - totalOutflow;
        const netCls        = net >= 0 ? 'rpt-net--pos' : 'rpt-net--neg';

        const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        // ── Stats strip ─────────────────────────────────────────────────────
        const stats = [
            { label: `Income (${monthLabel})`, value: totalIncome, cls: 'rpt-stat--income' },
            { label: 'Bills',               value: totalBills,  cls: 'rpt-stat--bills'  },
            { label: 'Expense Budgets',     value: totalExpenses, cls: 'rpt-stat--exp'  },
            { label: 'Debt Minimums',       value: totalDebtMin,  cls: 'rpt-stat--debt' },
            { label: 'Net Remaining',       value: net,           cls: netCls            },
        ];
        const statsHTML = stats.map(s =>
            `<div class="rpt-stat ${s.cls}">
                <span class="rpt-stat-label">${s.label}</span>
                <span class="rpt-stat-value">${this.formatCurrency(s.value)}</span>
            </div>`).join('');

        // ── Income chart data (by source) ────────────────────────────────────
        const incomeLabels = [], incomeData = [];
        for (const inc of (this.incomes || [])) {
            const count = this._incomeDaysInMonth(inc, rptYear, rptMonth).length;
            if (count > 0) {
                incomeLabels.push(inc.name);
                incomeData.push(inc.amount * count);
            }
        }
        // Add bonuses in report month
        for (const b of (this.bonuses || [])) {
            if (!b.date) continue;
            const bd = new Date(b.date + 'T12:00:00');
            if (bd.getFullYear() === rptYear && bd.getMonth() === rptMonth) {
                incomeLabels.push(b.name);
                incomeData.push(b.amount);
            }
        }

        // ── Outflow chart data (by category / debt name) ─────────────────────
        const outflowLabels = [], outflowData = [], outflowColors = [];
        // Bills by category
        const billCats = {};
        for (const b of (this.bills || [])) { billCats[b.category || 'Other'] = (billCats[b.category || 'Other'] || 0) + b.amount; }
        for (const [cat, amt] of Object.entries(billCats)) {
            outflowLabels.push(`🧾 ${cat}`); outflowData.push(amt); outflowColors.push('#f59e0b');
        }
        // Expenses by category
        const expCats = {};
        for (const e of (this.expenses || [])) { expCats[e.category || 'Other'] = (expCats[e.category || 'Other'] || 0) + e.budgetAmount; }
        for (const [cat, amt] of Object.entries(expCats)) {
            outflowLabels.push(`💸 ${cat}`); outflowData.push(amt); outflowColors.push('#8b5cf6');
        }
        // Debt minimums
        for (const d of (this.debts || [])) {
            if ((d.minimumPayment || 0) > 0) {
                outflowLabels.push(`💳 ${d.name}`); outflowData.push(d.minimumPayment); outflowColors.push('#ef4444');
            }
        }

        const hasData = incomeData.length > 0 || outflowData.length > 0;

        container.innerHTML = `
            <div class="rpt-stats-strip">${statsHTML}</div>
            ${!hasData ? '<p class="rpt-empty-msg">Add income sources, bills, expenses, or debts to see charts.</p>' : `
            <div class="rpt-charts-row">
                <div class="rpt-chart-card">
                    <h4 class="rpt-chart-title">💰 Income This Month</h4>
                    <p class="rpt-chart-sub">By source</p>
                    <div class="rpt-chart-canvas-wrap">
                        <canvas id="rptIncomeChart"></canvas>
                    </div>
                </div>
                <div class="rpt-chart-card">
                    <h4 class="rpt-chart-title">📤 Outflow This Month</h4>
                    <p class="rpt-chart-sub">Bills, expenses &amp; debt minimums by category</p>
                    <div class="rpt-chart-canvas-wrap">
                        <canvas id="rptOutflowChart"></canvas>
                    </div>
                </div>
            </div>`}`;

        if (!hasData) return;

        const fmt = v => this.formatCurrency(v);
        const isDark = document.body.classList.contains('dark-mode');
        const labelColor = isDark ? '#d1d5db' : '#374151';

        const incomeColors = ['#10b981','#34d399','#6ee7b7','#a7f3d0','#059669','#047857','#065f46'];

        // Income doughnut
        if (incomeData.length > 0) {
            const cvs = document.getElementById('rptIncomeChart');
            if (cvs) {
                if (this._rptIncomeChart) { this._rptIncomeChart.destroy(); this._rptIncomeChart = null; }
                this._rptIncomeChart = new Chart(cvs, {
                    type: 'doughnut',
                    data: {
                        labels: incomeLabels,
                        datasets: [{ data: incomeData, backgroundColor: incomeColors, borderColor: isDark ? '#1f2937' : '#fff', borderWidth: 2 }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: labelColor, usePointStyle: true, padding: 10, font: { size: 11 } } },
                            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.parsed)}` } }
                        }
                    }
                });
            }
        }

        // Outflow horizontal bar
        if (outflowData.length > 0) {
            const cvs = document.getElementById('rptOutflowChart');
            if (cvs) {
                if (this._rptOutflowChart) { this._rptOutflowChart.destroy(); this._rptOutflowChart = null; }
                this._rptOutflowChart = new Chart(cvs, {
                    type: 'bar',
                    data: {
                        labels: outflowLabels,
                        datasets: [{ data: outflowData, backgroundColor: outflowColors, borderRadius: 4 }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: ctx => fmt(ctx.parsed.x) } }
                        },
                        scales: {
                            x: { ticks: { color: labelColor, callback: v => fmt(v) }, grid: { color: isDark ? '#374151' : '#e5e7eb' } },
                            y: { ticks: { color: labelColor }, grid: { display: false } }
                        }
                    }
                });
            }
        }
    }

    // ── Money Flow ──────────────────────────────────────────────────────────
    _renderReportsMoneyFlow() {
        const container = document.getElementById('reportsMoneyFlow');
        if (!container) return;

        const rptDate  = this._getReportDate();
        const year     = rptDate.getFullYear();
        const month    = rptDate.getMonth();
        const now      = new Date();
        const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayDay   = isCurrentMonth ? now.getDate() : null;
        const monthLabel = rptDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        // Build per-day income and outflow arrays (indexed 1..daysInMonth)
        const dailyIn  = new Array(daysInMonth + 1).fill(0);
        const dailyOut = new Array(daysInMonth + 1).fill(0);

        // Income paydays
        for (const inc of (this.incomes || [])) {
            for (const d of this._incomeDaysInMonth(inc, year, month)) {
                dailyIn[d] += inc.amount;
            }
        }
        // Bonuses
        for (const b of (this.bonuses || [])) {
            if (!b.date) continue;
            const bd = new Date(b.date + 'T12:00:00');
            if (bd.getFullYear() === year && bd.getMonth() === month) {
                dailyIn[bd.getDate()] += b.amount;
            }
        }
        // Bills
        for (const bill of (this.bills || [])) {
            const d = Math.min(bill.dueDay || 1, daysInMonth);
            dailyOut[d] += bill.amount;
        }
        // Debt minimums
        for (const debt of (this.debts || [])) {
            const d = Math.min(debt.dueDate || 1, daysInMonth);
            dailyOut[d] += debt.minimumPayment || 0;
        }

        // Build cumulative series
        const labels = [];
        const cumInData  = [];
        const cumOutData = [];
        const netData    = [];
        let cumIn = 0, cumOut = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            cumIn  += dailyIn[d];
            cumOut += dailyOut[d];
            labels.push(d);
            cumInData.push(parseFloat(cumIn.toFixed(2)));
            cumOutData.push(parseFloat(cumOut.toFixed(2)));
            netData.push(parseFloat((cumIn - cumOut).toFixed(2)));
        }

        const hasAnyData = cumIn > 0 || cumOut > 0;

        // ── Per-account balance section ──────────────────────────────────────
        let acctSectionHTML = '';
        if (this.accounts && this.accounts.length > 0) {
            const mLabel = monthLabel;
            const typeIcon = { Checking:'🏦', Savings:'💰', Cash:'💵', Investment:'📈', 'Credit Card':'💳', Loan:'🏠', Other:'🗂️' };
            const acctRows = this.accounts.map(a => {
                const proj = this.computeAccountBalance(a.id, year, month);
                const diff = proj - a.startingBalance;
                const diffClass = diff >= 0 ? 'acct-mf-diff--pos' : 'acct-mf-diff--neg';
                const diffSign  = diff >= 0 ? '+' : '';
                return `<div class="acct-mf-row">
                    <span class="acct-mf-icon">${typeIcon[a.type] || '🗂️'}</span>
                    <span class="acct-mf-name">${a.name}</span>
                    <span class="acct-mf-type">${a.type}</span>
                    <span class="acct-mf-start">${this.formatCurrency(a.startingBalance)}</span>
                    <span class="acct-mf-proj">${this.formatCurrency(proj)}</span>
                    <span class="acct-mf-diff ${diffClass}">${diffSign}${this.formatCurrency(diff)}</span>
                </div>`;
            }).join('');
            acctSectionHTML = `
                <div class="acct-mf-section">
                    <h4 class="acct-mf-title">🏦 Account Balances — ${mLabel}</h4>
                    <p class="rpt-chart-sub">Starting balance vs. projected end-of-month after all linked income, debts, bills and expenses.</p>
                    <div class="acct-mf-header">
                        <span></span>
                        <span>Account</span>
                        <span>Type</span>
                        <span>Starting</span>
                        <span>Projected</span>
                        <span>Change</span>
                    </div>
                    ${acctRows}
                </div>`;
        }

        container.innerHTML = `
            <h3 class="rpt-section-title">💰 Money Flow — ${monthLabel}</h3>
            <p class="rpt-chart-sub" style="margin:0 0 16px">Cumulative income, outflow, and net balance day by day through the month. Vertical dashed line = today.</p>
            ${!hasAnyData ? '<p class="rpt-empty-msg">Add income sources, bills, or debts to see the money flow chart.</p>' : `
            <div class="rpt-moneyflow-wrap">
                <canvas id="rptMoneyFlowChart"></canvas>
            </div>`}
            ${acctSectionHTML}`;

        if (!hasAnyData) return;

        const cvs = document.getElementById('rptMoneyFlowChart');
        if (!cvs) return;
        if (this._rptMoneyFlowChart) { this._rptMoneyFlowChart.destroy(); this._rptMoneyFlowChart = null; }

        const fmt = v => this.formatCurrency(v);
        const isDark = document.body.classList.contains('dark-mode');
        const gridColor  = isDark ? '#374151' : '#e5e7eb';
        const labelColor = isDark ? '#d1d5db' : '#374151';

        this._rptMoneyFlowChart = new Chart(cvs, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Cumulative Income',
                        data: cumInData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                        borderWidth: 2,
                    },
                    {
                        label: 'Cumulative Outflow',
                        data: cumOutData,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.06)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                        borderWidth: 2,
                    },
                    {
                        label: 'Net Balance',
                        data: netData,
                        borderColor: '#2563eb',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 3,
                        borderWidth: 2.5,
                        borderDash: [],
                    },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { color: labelColor, usePointStyle: true, padding: 14, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
                        }
                    },
                    // Today annotation via a plugin-free vertical line drawn on afterDraw
                    annotation: undefined
                },
                scales: {
                    x: {
                        title: { display: true, text: `Day of ${monthLabel}`, color: labelColor, font: { size: 11 } },
                        ticks: { color: labelColor, maxTicksLimit: 16 },
                        grid: { color: gridColor }
                    },
                    y: {
                        title: { display: true, text: 'Amount ($)', color: labelColor, font: { size: 11 } },
                        ticks: { color: labelColor, callback: v => fmt(v) },
                        grid: { color: gridColor }
                    }
                }
            },
            plugins: [{
                // Draw a vertical dashed line at today's day (current month only)
                id: 'todayLine',
                afterDraw(chart) {
                    if (!todayDay) return; // not current month — skip
                    const todayIdx = todayDay - 1;
                    if (todayIdx < 0 || todayIdx >= chart.data.labels.length) return;
                    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                    const xPos = x.getPixelForValue(todayIdx);
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(xPos, top);
                    ctx.lineTo(xPos, bottom);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = isDark ? 'rgba(251,191,36,0.7)' : 'rgba(37,99,235,0.45)';
                    ctx.setLineDash([5, 4]);
                    ctx.stroke();
                    ctx.restore();
                }
            }]
        });
    }
}

// Initialize the app when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DebtTrackerApp();
});
