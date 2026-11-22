export const shorthands = undefined;

// Change log (#580): one row per create/update/delete made through the API's
// generic routers and the plan-settings PATCH, written in the same SQL
// statement as the change (server/src/audit.js). `before`/`after` hold the
// record in the API's JSON shape. Rows older than AUDIT_LOG_RETENTION_DAYS are
// pruned by the prune-sessions job. Not a user resource: Clear All Data empties
// it through DELETE /api/audit-log. Idempotent.
export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            table_name text NOT NULL,
            row_id text NOT NULL,
            op text NOT NULL CHECK (op IN ('create', 'update', 'delete')),
            before jsonb,
            after jsonb,
            at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON audit_log (user_id, id DESC);
        CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at);
    `);
}

// MIGRATION SAFETY NOTE: rolling back drops the table, so the whole change
// history is lost. No other table references it.
export async function down(pgm) {
    pgm.sql(`
        DROP TABLE IF EXISTS audit_log;
    `);
}
