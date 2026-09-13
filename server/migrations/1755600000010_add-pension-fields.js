export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts
            ADD COLUMN pension_annual_salary numeric NOT NULL DEFAULT 0,
            ADD COLUMN pension_contribution_rate_pct numeric NOT NULL DEFAULT 0,
            ADD COLUMN pension_vesting_years integer NOT NULL DEFAULT 0,
            ADD COLUMN pension_estimated_monthly_benefit numeric NOT NULL DEFAULT 0,
            ADD COLUMN pension_years_of_service integer NOT NULL DEFAULT 0;

        ALTER TABLE accounts
            DROP CONSTRAINT accounts_retirement_subtype_check,
            ADD CONSTRAINT accounts_retirement_subtype_check
                CHECK (retirement_subtype IN ('401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Pension', 'Other'));

        ALTER TABLE retirement_snapshots
            ADD COLUMN annual_salary numeric;
    `);
}

export async function down(pgm) {
    pgm.sql(`
        ALTER TABLE retirement_snapshots DROP COLUMN annual_salary;
        ALTER TABLE accounts
            DROP CONSTRAINT accounts_retirement_subtype_check,
            ADD CONSTRAINT accounts_retirement_subtype_check
                CHECK (retirement_subtype IN ('401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Other'));
        ALTER TABLE accounts
            DROP COLUMN pension_annual_salary,
            DROP COLUMN pension_contribution_rate_pct,
            DROP COLUMN pension_vesting_years,
            DROP COLUMN pension_estimated_monthly_benefit,
            DROP COLUMN pension_years_of_service;
    `);
}
