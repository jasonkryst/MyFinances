export const shorthands = undefined;

export async function up(pgm) {
    pgm.sql(`
        CREATE TABLE users (
            id bigserial PRIMARY KEY,
            email text NOT NULL UNIQUE,
            password_hash text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE sessions (
            id text PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at timestamptz NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`DROP TABLE sessions; DROP TABLE users;`);
}
