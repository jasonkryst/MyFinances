export async function up(db) {
    await db.query(`
        CREATE TABLE password_reset_tokens (
            id          BIGSERIAL PRIMARY KEY,
            user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash  TEXT NOT NULL UNIQUE,
            expires_at  TIMESTAMPTZ NOT NULL,
            used_at     TIMESTAMPTZ
        )
    `);
    await db.query('CREATE INDEX prt_user_id_idx ON password_reset_tokens (user_id)');
    await db.query('CREATE INDEX prt_token_hash_idx ON password_reset_tokens (token_hash)');
}

export async function down(db) {
    await db.query('DROP TABLE IF EXISTS password_reset_tokens');
}
