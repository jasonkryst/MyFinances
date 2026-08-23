export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE plan_settings (
            user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            strategy text,
            monthly_payment numeric,
            per_month_stimulus numeric[] NOT NULL DEFAULT '{}',
            ledger_settings jsonb NOT NULL DEFAULT '{"accountFilter":"all","dateRange":"all","sortKey":"date","sortDir":"desc"}',
            forecast_settings jsonb NOT NULL DEFAULT '{"rangeMonths":1,"accountId":"total","notableThresholdPct":130}'
        );

        CREATE TABLE net_worth_milestones_awarded (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            milestone integer NOT NULL,
            PRIMARY KEY (user_id, milestone)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE net_worth_milestones_awarded; DROP TABLE plan_settings;`);
}
