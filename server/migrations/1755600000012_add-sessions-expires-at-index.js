export const shorthands = undefined;

// Supports future session-sweep jobs that delete expired rows.
// Without this index a sweep would full-scan the sessions table.
export async function up(pgm) {
    pgm.sql('CREATE INDEX sessions_expires_at_idx ON sessions (expires_at)');
}

export async function down(pgm) {
    pgm.sql('DROP INDEX IF EXISTS sessions_expires_at_idx');
}
