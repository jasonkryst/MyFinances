// Pure retirement projection calculations — no DOM/app state access.

export function computeRetirementProjection(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget) {
    if (!(monthsUntilTarget > 0)) return currentBalance;
    const monthlyRate = (Number(annualRatePct) || 0) / 100 / 12;
    let balance = Number(currentBalance) || 0;
    const contribution = Number(monthlyContribution) || 0;
    for (let i = 0; i < monthsUntilTarget; i++) {
        balance = balance * (1 + monthlyRate) + contribution;
    }
    return balance;
}

export function splitGrowthFromContribution(snapshotsForOneAccount) {
    const sorted = [...(snapshotsForOneAccount || [])].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((snap, i) => {
        const contribution = Number(snap.contribution) || 0;
        if (i === 0) return { date: snap.date, contribution, growth: 0 };
        const prevBalance = Number(sorted[i - 1].balance) || 0;
        const balance = Number(snap.balance) || 0;
        return { date: snap.date, contribution, growth: balance - prevBalance - contribution };
    });
}
