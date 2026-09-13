import { createCrudResource } from '../crudRouter.js';
import { sanitizeAccount } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'accounts',
    sanitize: sanitizeAccount,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        startingBalance: 'starting_balance',
        interestRate: 'interest_rate',
        retirementSubtype: 'retirement_subtype',
        rateOfReturn: 'rate_of_return',
        employerMatchPercent: 'employer_match_percent',
        pensionAnnualSalary: 'pension_annual_salary',
        pensionContributionRatePct: 'pension_contribution_rate_pct',
        pensionVestingYears: 'pension_vesting_years',
        pensionEstimatedMonthlyBenefit: 'pension_estimated_monthly_benefit',
        pensionYearsOfService: 'pension_years_of_service'
    }
});
