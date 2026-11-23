export const shorthands = undefined;

// #581: read-only personal API tokens. Only the SHA-256 of a token is stored
// (token_hash); token_prefix is its first characters, shown so the user can
// tell tokens apart. public_id is the id the API exposes. scope is 'read'
// (GET/HEAD only); the CHECK keeps any other scope out until one is designed.
//
// MIGRATION SAFETY NOTE: down() drops the table, revoking every token.
export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS api_tokens (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
            name text NOT NULL,
            token_hash text NOT NULL UNIQUE,
            token_prefix text NOT NULL,
            scope text NOT NULL DEFAULT 'read' CHECK (scope IN ('read')),
            created_at timestamptz NOT NULL DEFAULT now(),
            last_used_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens (user_id);
    `);
}

export async function down(pgm) {
    pgm.sql('DROP TABLE IF EXISTS api_tokens');
}
