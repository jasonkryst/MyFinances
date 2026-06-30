// Break-even analysis calculation for a single credit-card debt.
// Compares the user's planned payment against minimum-only payoff.
// DebtCalculator is a global (loaded as a classic script before ES modules).

const MAX_MONTHS = 600;

/**
 * Run a fixed-payment single-debt simulation using DebtCalculator.
 * Returns { months, totalInterest, balances } or null on failure.
 * `balances[0]` = original balance; subsequent entries = end-of-month balance.
 *
 * @param {object} debt
 * @param {number} monthlyPayment
 * @returns {{ months: number, totalInterest: number, balances: number[] } | null}
 */
function runFixedScenario(debt, monthlyPayment) {
    if (!monthlyPayment || monthlyPayment <= 0) return null;
    try {
        const singleDebt = {
            ...debt,
            id: debt.id ?? 1,
            name: debt.name ?? 'debt',
            debtType: 'creditCard',
            accountBalance: debt.accountBalance,
            interestRate: debt.interestRate || 0,
            minimumPayment: Math.min(monthlyPayment, debt.minimumPayment || monthlyPayment),
            dueDate: debt.dueDate || 1,
        };
        const result = DebtCalculator.calculatePaymentPlan([singleDebt], monthlyPayment, 'avalanche', 0);
        const months = result.workingDebts[0].paidOffMonth || result.paymentPlan.length;
        const totalInterest = result.workingDebts[0].totalInterest || 0;
        const balances = [debt.accountBalance];
        for (const month of result.paymentPlan) {
            const p = month.payments[0];
            balances.push(p != null ? p.balance : 0);
        }
        return { months, totalInterest, balances };
    } catch {
        return null;
    }
}

/**
 * Run a percent-of-balance minimum-only simulation (custom loop).
 * Each month's payment = max(debt.minimumPayment, balance × minPct / 100).
 * Returns { months, totalInterest, balances }.
 *
 * @param {object} debt
 * @param {number} minPct - Percent of balance (e.g. 2 for 2%)
 * @returns {{ months: number, totalInterest: number, balances: number[] }}
 */
function runPercentScenario(debt, minPct) {
    const dailyRate = (debt.interestRate || 0) / 100 / 365;
    const minFixed = debt.minimumPayment || 0;
    let balance = debt.accountBalance;
    let totalInterest = 0;
    let months = 0;
    const balances = [balance];

    while (balance > 0.01 && months < MAX_MONTHS) {
        const daysInMonth = 30;
        const monthlyInterest = balance * (Math.pow(1 + dailyRate, daysInMonth) - 1);
        const percentPayment = balance * minPct / 100;
        const payment = Math.min(Math.max(minFixed, percentPayment), balance + monthlyInterest);
        const interestPaid = Math.min(monthlyInterest, payment);
        balance = Math.max(0, balance - (payment - interestPaid));
        totalInterest += interestPaid;
        months++;
        balances.push(parseFloat(balance.toFixed(2)));
    }

    return { months, totalInterest, balances };
}

/**
 * Compute break-even data for a single credit-card debt.
 *
 * @param {object} debt - A debt object from app.debts (debtType must be 'creditCard')
 * @param {object} [options]
 * @param {'fixed'|'percent'} [options.minType='fixed'] - How minimum payment is modeled
 * @param {number} [options.minPct=2] - Percent of balance used in 'percent' mode
 * @param {number} [options.planPayment] - Monthly payment for the "your plan" scenario;
 *   defaults to debt.minimumPayment when omitted (no-plan state)
 * @returns {{ planMonths: number, planInterest: number, minMonths: number, minInterest: number,
 *             monthsSaved: number, interestSaved: number,
 *             planBalances: number[], minBalances: number[] } | null}
 */
export function computeBreakEven(debt, options = {}) {
    if (!debt || debt.debtType === 'fixedAmount') return null;
    if (!debt.accountBalance || debt.accountBalance <= 0) return null;
    const minPayment = debt.minimumPayment || 0;
    if (minPayment <= 0) return null;

    const minType = options.minType || 'fixed';
    const minPct = options.minPct > 0 ? options.minPct : 2;
    const planPayment = options.planPayment > 0 ? options.planPayment : minPayment;

    const planScenario = runFixedScenario(debt, planPayment);
    if (!planScenario) return null;

    const minScenario = minType === 'percent'
        ? runPercentScenario(debt, minPct)
        : runFixedScenario(debt, minPayment);
    if (!minScenario) return null;

    return {
        planMonths: planScenario.months,
        planInterest: parseFloat(planScenario.totalInterest.toFixed(2)),
        minMonths: minScenario.months,
        minInterest: parseFloat(minScenario.totalInterest.toFixed(2)),
        monthsSaved: Math.max(0, minScenario.months - planScenario.months),
        interestSaved: parseFloat(Math.max(0, minScenario.totalInterest - planScenario.totalInterest).toFixed(2)),
        planBalances: planScenario.balances,
        minBalances: minScenario.balances,
    };
}
