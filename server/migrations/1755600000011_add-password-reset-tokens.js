export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE password_reset_tokens (
            id          BIGSERIAL PRIMARY KEY,
            user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  TIMESTAMPTZ NOT NULL,
            used_at     TIMESTAMPTZ
        );

        CREATE INDEX prt_user_id_idx ON password_reset_tokens (user_id);
        CREATE INDEX prt_token_hash_idx ON password_reset_tokens (token_hash);
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE IF EXISTS password_reset_tokens;`);
}
