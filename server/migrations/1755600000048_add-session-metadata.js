export const shorthands = undefined;

// #683: Settings -> Security lists the user's active sessions.
// - public_id: the opaque id the API exposes. The primary key is the hash of
//   the cookie token and is never sent to the browser.
// - last_seen_at: refreshed by requireSession at most every few minutes.
// - user_agent: the raw header (capped), summarized on output.
// - ip_prefix: the client address truncated to /24 (IPv4) or /48 (IPv6);
//   the full address is never stored.
// known_devices remembers each browser/OS pair a user has signed in from, so
// a sign-in from a pair never seen before can send an email (notifyNewSignIn).
//
// MIGRATION SAFETY NOTE: down() drops the new columns and known_devices,
// discarding session device details and the remembered devices. Sessions
// themselves survive, so nobody is signed out.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_prefix text;
        CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_id_idx ON sessions (public_id);

        CREATE TABLE IF NOT EXISTS known_devices (
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_key text NOT NULL,
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, device_key)
        );
    `);
}

export async function down(pgm) {
    pgm.sql(`
        DROP TABLE IF EXISTS known_devices;
        DROP INDEX IF EXISTS sessions_public_id_idx;
        ALTER TABLE sessions DROP COLUMN IF EXISTS ip_prefix;
        ALTER TABLE sessions DROP COLUMN IF EXISTS user_agent;
        ALTER TABLE sessions DROP COLUMN IF EXISTS last_seen_at;
        ALTER TABLE sessions DROP COLUMN IF EXISTS public_id;
    `);
}
