export const shorthands = undefined;

// #579: the background job runner's claim table. One row per job per period
// (e.g. 'net-worth-snapshot' / '2026-11'); the unique key is what makes a job
// run once per period even across restarts or two server processes. Not a
// user resource: no user_id, no foreign key, no row_version.
// IF NOT EXISTS keeps a renumber or a re-run harmless.
export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS job_runs (
            id bigserial PRIMARY KEY,
            job_name text NOT NULL,
            period_key text NOT NULL,
            status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
            attempts integer NOT NULL DEFAULT 1,
            started_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz,
            error text,
            result jsonb,
            CONSTRAINT job_runs_job_period_key UNIQUE (job_name, period_key)
        );
    `);
}

// MIGRATION SAFETY NOTE: down() drops the table, discarding the job run
// history. Nothing else is touched; after a rollback a later re-apply may
// run the current period's jobs once more (both jobs are idempotent).
export async function down(pgm) {
    pgm.sql('DROP TABLE IF EXISTS job_runs;');
}
