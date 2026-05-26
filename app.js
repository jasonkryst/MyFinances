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
        this.lastPaymentPlan = null;  // Most recently calculated paymentPlan array
        this.lastSummary = null;      // Summary object from DebtCalculator.generateSummary
        this.perMonthStimulus = [];   // Extra payment amounts indexed by plan month (0-based)
        this.editingDebtId = null;    // ID of the debt currently in inline-edit mode, or null
        this.storageKey = 'debtTrackerData';
        
        this.initializeEventListeners();
        this.loadFromStorage();
        this.updateUI();
        this.updateFormVisibility();
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
            monthlyPaymentEl.addEventListener('change', () => this.saveToStorage());
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

        // Export debts as JSON
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => this.exportDebtsJSON());
        }

        // Import debts from JSON — button triggers hidden file input
        const importJsonBtn = document.getElementById('importJsonBtn');
        const importJsonInput = document.getElementById('importJsonInput');
        if (importJsonBtn && importJsonInput) {
            importJsonBtn.addEventListener('click', () => importJsonInput.click());
            importJsonInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.importDebtsJSON(file);
                    // Reset so the same file can be re-selected if needed
                    importJsonInput.value = '';
                }
            });
        }

        // Top nav page buttons (Debts / Add Debt / Strategy / Results)
        document.querySelectorAll('.page-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = btn.getAttribute('data-page');
                if (page) {
                    this.switchPage(page);
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

        // Target payoff date: "Calculate" button runs binary-search back-calculator
        const calcTargetBtn = document.getElementById('calcTargetBtn');
        if (calcTargetBtn) {
            calcTargetBtn.addEventListener('click', () => this.calculateRequiredPayment());
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
        // Reset form
        document.getElementById('debtForm').reset();
        // Clear form visibility
        this.updateFormVisibility();
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
            // Switch to results page for a focused UX
            this.switchPage('results');
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
            // Hide all page sections
            document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
            this.switchPage('add');
            return;
        }

        document.getElementById('emptyState').style.display = 'none';
        // Hide all page sections
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        // Default to Debts page
        this.switchPage('debts');
        this.renderDebtsList();
    }

    /**
     * Activate a top-level page section and update the nav button state.
     * @param {string} pageName - One of `'debts'`, `'add'`, `'strategy'`, `'results'`
     */
    switchPage(pageName) {
        // update nav active state
        document.querySelectorAll('.page-button').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.page-button[data-page="${pageName}"]`);
        if (btn) btn.classList.add('active');

        // list of page section ids
        const mapping = {
            debts: 'debtsSection',
            add: 'inputSection',
            strategy: 'strategySection',
            results: 'resultsSection'
        };

        // hide all sections
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));

        const id = mapping[pageName];
        if (id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('active');
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
        if (!debt.debtStartDate || debt.debtType !== 'creditCard') return null;
        const start = new Date(debt.debtStartDate);
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
        // Render category summary
        const categorySummary = document.getElementById('categorySummary');
        if (categorySummary) {
            // Group debts by category
            const summary = {};
            for (const d of this.debts) {
                const cat = d.category || 'Uncategorized';
                if (!summary[cat]) summary[cat] = { count: 0, total: 0 };
                summary[cat].count++;
                // For fixed-amount debts, use fixedAmount; for credit card debts, use accountBalance
                const amount = d.debtType === 'fixedAmount' ? d.fixedAmount : d.accountBalance;
                summary[cat].total += amount;
            }
            // Build summary HTML
            let html = '<strong>Debts by Category:</strong> ';
            html += Object.entries(summary).map(([cat, val]) =>
                `${cat}: ${val.count} (${this.formatCurrency(val.total)})`
            ).join(' &nbsp;|&nbsp; ');
            categorySummary.innerHTML = html;
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
        const nameEl = document.getElementById(`inline-name-${debtId}`);
        const catEl = document.getElementById(`inline-category-${debtId}`);
        
        if (!nameEl) {
            alert('Missing debt name field');
            return;
        }

        const name = nameEl.value.trim();
        const category = catEl ? catEl.value.trim() : '';
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
                category
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
            const startDateEl = document.getElementById(`inline-start-date-cc-${debtId}`);
            const debtStartDate = startDateEl ? (startDateEl.value || null) : this.debts[idx]?.debtStartDate || null;

            if (!name || isNaN(accountBalance) || isNaN(interestRate) || isNaN(minimumPayment) || isNaN(dueDate)) {
                alert('Please fill in all required fields');
                return;
            }

            const idx = this.debts.findIndex(d => d.id === debtId);
            if (idx === -1) return;

            this.debts[idx] = {
                ...this.debts[idx],
                name,
                accountBalance,
                interestRate,
                priority,
                minimumPayment,
                dueDate,
                debtStartDate,
                category
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
    }

    /**
     * Download all current debts as a JSON backup file.
     * The file format is:
     * ```json
     * { "version": "1.0", "exportedAt": "<ISO date>", "debts": [...] }
     * ```
     * The file is named `debts-backup-YYYY-MM-DD.json`.
     */
    exportDebtsJSON() {
        if (this.debts.length === 0) {
            alert('No debts to export. Add some debts first.');
            return;
        }

        const payload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            debts: this.debts
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debts-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import debts from a JSON file created by `exportDebtsJSON`.
     * Prompts the user to choose between **Replace** (wipe current list) or
     * **Merge** (append imported debts, skipping duplicates by name).
     * New IDs are assigned to imported debts on merge to avoid collisions.
     * @param {File} file - The JSON file selected by the user
     */
    importDebtsJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            let parsed;
            try {
                parsed = JSON.parse(e.target.result);
            } catch {
                alert('Invalid JSON file. Please select a valid debt backup file.');
                return;
            }

            // Accept both the envelope format and a bare array
            const incoming = Array.isArray(parsed) ? parsed : parsed.debts;

            if (!Array.isArray(incoming) || incoming.length === 0) {
                alert('No debts found in the selected file.');
                return;
            }

            // Validate each entry has at minimum a name field
            const valid = incoming.filter(d => d && typeof d.name === 'string' && d.name.trim());
            if (valid.length === 0) {
                alert('The file contained no valid debt entries (each entry must have at least a "name").');
                return;
            }

            const action = confirm(
                `Found ${valid.length} debt(s) in the file.\n\n` +
                `• OK  — Replace your current debt list with the imported debts\n` +
                `• Cancel — Merge the imported debts into your existing list\n\n` +
                `(Choose OK to replace, Cancel to merge)`
            );

            if (action) {
                // Replace
                this.debts = valid.map((d, i) => ({ ...d, id: Date.now() + i }));
            } else {
                // Merge — skip debts whose name already exists
                const existingNames = new Set(this.debts.map(d => d.name.toLowerCase()));
                let skipped = 0;
                const toAdd = [];
                for (const d of valid) {
                    if (existingNames.has(d.name.toLowerCase())) {
                        skipped++;
                    } else {
                        toAdd.push({ ...d, id: Date.now() + toAdd.length });
                        existingNames.add(d.name.toLowerCase());
                    }
                }
                this.debts = [...this.debts, ...toAdd];
                if (skipped > 0) {
                    alert(`Merged ${toAdd.length} debt(s). Skipped ${skipped} duplicate name(s).`);
                }
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
        this.lastPaymentPlan = null;
        this.lastSummary = null;
        this.perMonthStimulus = [];
        this.saveToStorage();
        this.updateUI();
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('debtForm').reset();
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

        // Build debt color map
        const debtColors = {};
        const palette = [
            '#2563eb','#dc2626','#059669','#d97706','#7c3aed',
            '#db2777','#0891b2','#65a30d','#ea580c','#6366f1'
        ];
        let colorIdx = 0;
        for (const debt of this.debts) {
            debtColors[debt.name] = palette[colorIdx++ % palette.length];
        }

        // Group payments by year/month into ordered array
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

            // Group payments by due day
            const dayPayments = {};
            for (const p of payments) {
                if (!dayPayments[p.dueDay]) dayPayments[p.dueDay] = [];
                dayPayments[p.dueDay].push(p);
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
                const events = dayPayments[day] || [];
                const hasEvents = events.length > 0;
                const isToday = (year === todayYear && month === todayMonth && day === todayDay);
                gridHTML += `<div class="cal-cell${hasEvents ? ' cal-has-events' : ''}${isToday ? ' cal-today' : ''}">
                    <span class="cal-day-num">${day}</span>`;
                for (const ev of events) {
                    gridHTML += `<div class="cal-event" style="background:${ev.color};" title="${ev.name}: ${this.formatCurrency(ev.payment)}">
                        <span class="cal-event-name">${ev.name}</span>
                        <span class="cal-event-amount">${this.formatCurrency(ev.payment)}</span>
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
        const debt = this.debts.find(d => d.id === debtId);
        if (!debt || debt.debtType !== 'creditCard') return;
        const modal = document.getElementById('updateBalanceModal');
        if (!modal) return;
        document.getElementById('updateBalanceDebtName').textContent = debt.name;
        document.getElementById('updateBalanceCurrent').textContent = this.formatCurrency(debt.accountBalance);
        const input = document.getElementById('updateBalanceInput');
        input.value = debt.accountBalance.toFixed(2);
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 50);

        const close = () => { modal.style.display = 'none'; };
        document.getElementById('confirmUpdateBalance').onclick = () => {
            const newBal = parseFloat(input.value);
            if (isNaN(newBal) || newBal < 0) { alert('Please enter a valid balance (0 or more).'); return; }
            this.updateDebtBalance(debtId, newBal);
            close();
        };
        document.getElementById('cancelUpdateBalanceBtn').onclick = close;
        document.getElementById('cancelUpdateBalance').onclick = close;
        modal.onclick = (e) => { if (e.target === modal) close(); };
    }

    /**
     * Apply a new balance to a debt, preserve `originalBalance`, and
     * recalculate the payment plan if one already exists.
     * @param {number} debtId      - ID of the debt to update
     * @param {number} newBalance  - The new current balance (≥ 0)
     */
    updateDebtBalance(debtId, newBalance) {
        const idx = this.debts.findIndex(d => d.id === debtId);
        if (idx === -1) return;
        // Preserve originalBalance — only update accountBalance
        if (!this.debts[idx].originalBalance) {
            this.debts[idx].originalBalance = this.debts[idx].accountBalance;
        }
        this.debts[idx].accountBalance = newBalance;
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
}

// Initialize the app when the DOM is ready
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new DebtTrackerApp();
});
