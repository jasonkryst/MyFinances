/**
 * DebtCalculator
 *
 * Core logic for debt payoff calculations and strategies.
 *
 * Features:
 * - Supports Avalanche, Snowball, and Priority strategies
 * - Handles minimum payments, overage, and per-month stimulus (extra payments)
 * - Uses daily compounding interest for accurate modeling (credit card style)
 * - Allocates payments and stimulus according to selected strategy
 * - Returns detailed payment schedule and summary
 */

class DebtCalculator {
    // Main class for all debt payoff calculations and scheduling
    /**
     * Calculate payment plan based on strategy
     * @param {Array} debts - Array of debt objects
     * @param {number} monthlyPayment - Total monthly payment amount
     * @param {string} strategy - Payment strategy (avalanche, snowball, priority-lowest, priority-highest)
     * @returns {Array} Payment plan with monthly breakdown
     */
    /**
     * Calculate payment plan based on strategy and daily compounding interest
     *
     * @param {Array} debts - Array of debt objects
     * @param {number} monthlyPayment - Total monthly payment amount
     * @param {string} strategy - Payment strategy (avalanche, snowball, priority-lowest, priority-highest)
     * @param {number|Array} monthlyStimulus - Per-month extra payment(s) (stimulus)
     * @returns {Object} { paymentPlan, workingDebts }
     *
     * - Applies minimum payments first, then overage by strategy order, then stimulus by strategy order
     * - Uses daily compounding for interest (credit card style)
     * - Each month, tracks principal, interest, and payoff status for each debt
     */
    static calculatePaymentPlan(debts, monthlyPayment, strategy = 'avalanche', monthlyStimulus = 0) {
        if (!debts || debts.length === 0) {
            throw new Error('No debts provided');
        }

        if (monthlyPayment <= 0) {
            throw new Error('Monthly payment must be greater than 0');
        }

    // Calculate total minimum payments required for all debts
        const totalMinimumPayment = debts.reduce((sum, debt) => {
            return sum + (debt.minimumPayment || 0);
        }, 0);

        if (monthlyPayment < totalMinimumPayment) {
            throw new Error(`Monthly payment of ${monthlyPayment.toFixed(2)} is less than total minimum payments required (${totalMinimumPayment.toFixed(2)}). Please increase your payment amount.`);
        }

    // Create deep copies of debts to avoid mutating original
        const workingDebts = debts.map(debt => ({
            ...debt,
            balance: debt.debtType === 'fixedAmount' ? debt.fixedAmount : debt.accountBalance,
            paidOffMonth: null,
            totalPrincipal: 0,
            totalInterest: 0,
            // For fixed-amount debts, calculate remaining months
            remainingMonths: debt.debtType === 'fixedAmount' ? 
                this.calculateMonthsBetweenDates(new Date(debt.fixedStartDate), new Date(debt.fixedEndDate)) : 
                null
        }));

        const paymentPlan = [];
        let month = 1;
        const maxMonths = 600; // Safety limit (50 years)

    // Main payoff loop: each iteration is one month
    while (this.hasUnpaidDebts(workingDebts) && month <= maxMonths) {
            // Calculate the date for this month and days in month
            const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() + month - 1);
            const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
            const monthPlan = {
                month,
                date: monthDate,
                payments: [],
                stimulusApplied: {} // Track how much stimulus is applied to each debt this month
            };

            // Determine payment order based on selected strategy (Avalanche, Snowball, etc.)
            const paymentOrder = this.getPaymentOrder(workingDebts, strategy);

            let remainingPayment = monthlyPayment;

            // First pass: Apply minimum payments to each debt, with daily compounding interest
            for (const debtIndex of workingDebts.map((_, i) => i)) {
                const debt = workingDebts[debtIndex];
                if (debt.paidOffMonth) continue;

                // Check if this is a fixed-amount debt
                if (debt.debtType === 'fixedAmount') {
                    // For fixed-amount debts, apply the fixed monthly amount if within the date range
                    const currentMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
                    const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
                    const startDate = new Date(debt.fixedStartDate);
                    const endDate = new Date(debt.fixedEndDate);
                    endDate.setDate(endDate.getDate() + 1); // Include the entire end date
                    
                    // Check if this month overlaps with the fixed-amount date range
                    if (currentMonth < endDate && nextMonth > startDate) {
                        const payment = debt.fixedAmount;
                        debt.totalPrincipal += payment;
                        remainingPayment -= payment; // Deduct from budget so it isn't treated as overage
                        
                        monthPlan.payments.push({
                            debtIndex,
                            debtName: debt.name,
                            payment: parseFloat(payment.toFixed(2)),
                            principal: parseFloat(payment.toFixed(2)),
                            interest: 0,
                            balance: parseFloat(debt.fixedAmount.toFixed(2)),
                            paidOff: false,
                        });
                    } else if (!debt.paidOffMonth && currentMonth >= endDate) {
                        // Mark as paid off only after the date range has ended
                        debt.paidOffMonth = month;
                    }
                } else {
                    // Credit card debt: apply minimum payment with daily compounding interest
                    const dailyRate = (debt.interestRate || 0) / 100 / 365;
                    const monthlyInterest = debt.balance * (Math.pow(1 + dailyRate, daysInMonth) - 1);
                    const minimumRequired = debt.minimumPayment || 0;

                    if (minimumRequired > 0) {
                        // Apply minimum payment
                        const minimumPayment = Math.min(minimumRequired, debt.balance + monthlyInterest);
                        const interestPaid = Math.min(monthlyInterest, minimumPayment);
                        const principalPaid = minimumPayment - interestPaid;

                        debt.balance -= principalPaid;
                        debt.totalPrincipal += principalPaid;
                        debt.totalInterest += interestPaid;

                        if (debt.balance <= 0.01) {
                            debt.balance = 0;
                            debt.paidOffMonth = month;
                        }

                        monthPlan.payments.push({
                            debtIndex,
                            debtName: debt.name,
                            payment: parseFloat(minimumPayment.toFixed(2)),
                            principal: parseFloat(principalPaid.toFixed(2)),
                            interest: parseFloat(interestPaid.toFixed(2)),
                            balance: parseFloat(Math.max(0, debt.balance).toFixed(2)),
                            paidOff: debt.paidOffMonth === month,
                            isMinimum: true
                        });

                        remainingPayment -= minimumPayment;
                    }
                }
            }

            // Second pass: Apply any remaining payment (overage) to debts in strategy order
            if (remainingPayment > 0.01) {
                for (const debtIndex of paymentOrder) {
                    const debt = workingDebts[debtIndex];
                    if (debt.paidOffMonth || remainingPayment < 0.01) continue;
                    if (debt.debtType === 'fixedAmount') continue; // Fixed debts never receive overage

                    // Daily compounding interest for this month
                    const dailyRate = (debt.interestRate || 0) / 100 / 365;
                    const monthlyInterest = debt.balance * (Math.pow(1 + dailyRate, daysInMonth) - 1);
                    const payment = Math.min(remainingPayment, debt.balance + monthlyInterest);

                    if (payment < 0.01) continue;

                    const interestPaid = Math.min(monthlyInterest, payment);
                    const principalPaid = payment - interestPaid;

                    debt.balance -= principalPaid;
                    debt.totalPrincipal += principalPaid;
                    debt.totalInterest += interestPaid;

                    if (debt.balance <= 0.01) {
                        debt.balance = 0;
                        debt.paidOffMonth = month;
                    }

                    // Check if this debt already has a minimum payment entry
                    const existingPaymentIndex = monthPlan.payments.findIndex(p => p.debtIndex === debtIndex);
                    
                    if (existingPaymentIndex >= 0) {
                        // Add to existing minimum payment
                        monthPlan.payments[existingPaymentIndex].payment += parseFloat(payment.toFixed(2));
                        monthPlan.payments[existingPaymentIndex].principal += parseFloat(principalPaid.toFixed(2));
                        monthPlan.payments[existingPaymentIndex].balance = parseFloat(Math.max(0, debt.balance).toFixed(2));
                        monthPlan.payments[existingPaymentIndex].paidOff = debt.paidOffMonth === month;
                    } else {
                        // Create new payment entry for extra payment
                        monthPlan.payments.push({
                            debtIndex,
                            debtName: debt.name,
                            payment: parseFloat(payment.toFixed(2)),
                            principal: parseFloat(principalPaid.toFixed(2)),
                            interest: parseFloat(interestPaid.toFixed(2)),
                            balance: parseFloat(Math.max(0, debt.balance).toFixed(2)),
                            paidOff: debt.paidOffMonth === month,
                            isExtra: true
                        });
                    }

                    remainingPayment -= payment;
                }
            }

            // Third pass: Apply stimulus (if any) to debts by strategy order
            // monthlyStimulus may be a number (same each month) or an array of per-month values
            let remainingStimulus = 0;
            if (Array.isArray(monthlyStimulus)) {
                remainingStimulus = monthlyStimulus[month - 1] || 0;
            } else {
                remainingStimulus = monthlyStimulus || 0;
            }
            if (remainingStimulus > 0.01) {
                for (const debtIndex of paymentOrder) {
                    const debt = workingDebts[debtIndex];
                    if (debt.paidOffMonth || remainingStimulus < 0.01) continue;
                    if (debt.debtType === 'fixedAmount') continue; // Fixed debts never receive stimulus

                    // Only apply to principal (no interest on stimulus)
                    const stimulusPayment = Math.min(remainingStimulus, debt.balance);
                    if (stimulusPayment < 0.01) continue;

                    debt.balance -= stimulusPayment;
                    debt.totalPrincipal += stimulusPayment;

                    if (debt.balance <= 0.01) {
                        debt.balance = 0;
                        debt.paidOffMonth = month;
                    }

                    // Add to existing payment entry if present, else create new
                    const existingPaymentIndex = monthPlan.payments.findIndex(p => p.debtIndex === debtIndex);
                    if (existingPaymentIndex >= 0) {
                        monthPlan.payments[existingPaymentIndex].payment += parseFloat(stimulusPayment.toFixed(2));
                        monthPlan.payments[existingPaymentIndex].principal += parseFloat(stimulusPayment.toFixed(2));
                        monthPlan.payments[existingPaymentIndex].balance = parseFloat(Math.max(0, debt.balance).toFixed(2));
                        monthPlan.payments[existingPaymentIndex].isStimulus = true;
                    } else {
                        monthPlan.payments.push({
                            debtIndex,
                            debtName: debt.name,
                            payment: parseFloat(stimulusPayment.toFixed(2)),
                            principal: parseFloat(stimulusPayment.toFixed(2)),
                            interest: 0,
                            balance: parseFloat(Math.max(0, debt.balance).toFixed(2)),
                            paidOff: debt.paidOffMonth === month,
                            isStimulus: true
                        });
                    }
                    // Track stimulus applied for this debt
                    monthPlan.stimulusApplied[debt.name] = (monthPlan.stimulusApplied[debt.name] || 0) + parseFloat(stimulusPayment.toFixed(2));
                    remainingStimulus -= stimulusPayment;
                }
            }

            paymentPlan.push(monthPlan);
            month++;
        }

        if (month > maxMonths) {
            throw new Error('Payment plan exceeds 50 years. Monthly payment may be too low.');
        }

        return { paymentPlan, workingDebts };
    }

    /**
     * Check if any debts remain unpaid
     */
    static hasUnpaidDebts(debts) {
        return debts.some(debt => {
            if (debt.paidOffMonth) return false;
            if (debt.debtType === 'fixedAmount') return false; // Fixed debts are date-range-driven, not balance-driven
            return debt.balance > 0.01;
        });
    }

    /**
     * Calculate total interest accrued in a month
     */
    /**
     * Calculate total interest accrued in a month (not used in main payoff, for reporting only)
     */
    static calculateMonthlyInterest(debts) {
        return debts.reduce((total, debt) => {
            if (debt.paidOffMonth) return total;
            return total + (debt.balance * debt.interestRate) / 100 / 12;
        }, 0);
    }

    /**
     * Get payment order based on strategy
     */
    /**
     * Get payment order for debts based on selected strategy
     *
     * - Avalanche: highest interest first
     * - Snowball: lowest balance first
     * - Priority: user-defined priority field
     */
    static getPaymentOrder(debts, strategy) {
        const activeDebts = debts
            .map((debt, index) => ({ ...debt, index }))
            .filter(debt => debt.paidOffMonth === null && debt.balance > 0.01);

        switch (strategy) {
            case 'snowball':
                // Lowest balance first
                return activeDebts
                    .sort((a, b) => a.balance - b.balance)
                    .map(d => d.index);

            case 'avalanche':
                // Highest interest rate first
                return activeDebts
                    .sort((a, b) => b.interestRate - a.interestRate)
                    .map(d => d.index);

            case 'priority-lowest':
                // Lowest priority number first (1 = lowest)
                return activeDebts
                    .sort((a, b) => {
                        const priorityA = a.priority || 0;
                        const priorityB = b.priority || 0;
                        return priorityA - priorityB;
                    })
                    .map(d => d.index);

            case 'priority-highest':
                // Highest priority number first (10 = highest)
                return activeDebts
                    .sort((a, b) => {
                        const priorityA = a.priority || 0;
                        const priorityB = b.priority || 0;
                        return priorityB - priorityA;
                    })
                    .map(d => d.index);

            default:
                return activeDebts.map(d => d.index);
        }
    }

    /**
     * Generate summary statistics
     */
    /**
     * Generate summary statistics for the payoff plan
     */
    static generateSummary(workingDebts, paymentPlan) {
        const totalDebt = workingDebts.reduce((sum, d) => sum + d.accountBalance, 0);
        const totalInterest = workingDebts.reduce((sum, d) => sum + d.totalInterest, 0);
        const totalMonths = paymentPlan.length;
        const maxPayOffDate = Math.max(...workingDebts.map(d => d.paidOffMonth || 0));

        return {
            totalDebt: parseFloat(totalDebt.toFixed(2)),
            totalInterest: parseFloat(totalInterest.toFixed(2)),
            totalPaid: parseFloat((totalDebt + totalInterest).toFixed(2)),
            monthsToPayOff: totalMonths,
            payOffDate: this.getPayOffDate(totalMonths)
        };
    }

    /**
     * Calculate payoff date from today
     */
    /**
     * Calculate payoff date from today, given number of months
     */
    static getPayOffDate(months) {
        const today = new Date();
        const payOffDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
        return payOffDate;
    }

    /**
     * Get the starting month based on current date
     * If after the 15th, start from next month; otherwise start from current month
     */
    /**
     * Get the starting month based on current date
     * If after the 15th, start from next month; otherwise start from current month
     */
    static getStartingMonth() {
        const today = new Date();
        const day = today.getDate();
        
        if (day > 15) {
            // After 15th, start from next month
            return new Date(today.getFullYear(), today.getMonth() + 1, 1);
        } else {
            // Before or on 15th, start from current month
            return new Date(today.getFullYear(), today.getMonth(), 1);
        }
    }

    /**
     * Get month name from month offset
     * @param {number} monthOffset - Number of months from starting month
     */
    /**
     * Get month name from month offset (for display)
     */
    static getMonthName(monthOffset) {
        const startDate = this.getStartingMonth();
        const targetDate = new Date(startDate.getFullYear(), startDate.getMonth() + monthOffset, 1);
        return targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    /**
     * Format date to readable string
     */
    /**
     * Format date to readable string (e.g., January 1, 2024)
     */
    static formatDate(date) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    /**
     * Calculate the number of months between two dates
     */
    static calculateMonthsBetweenDates(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        let months = 0;
        const tempDate = new Date(start);
        
        while (tempDate < end) {
            months++;
            tempDate.setMonth(tempDate.getMonth() + 1);
        }
        
        return months;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebtCalculator;
}
