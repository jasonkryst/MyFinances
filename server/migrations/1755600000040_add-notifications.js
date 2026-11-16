export const shorthands = undefined;

// #211: notifications.
//  - accounts.low_balance_threshold: the per-account low-balance alert amount
//    (null = no alert).
//  - notifications: one row per alert the notifications job raised. The
//    unique (user_id, dedupe_key) is what makes a repeated check never repeat
//    an alert; episode_key + resolved_at track balance alerts that stay open
//    while the balance is low. Not a user resource (no row_version, not
//    exported or imported); ON DELETE CASCADE removes a user's rows with them.
// IF NOT EXISTS keeps a renumber or a re-run harmless.
export async function up(pgm) {
    pgm.sql(`
        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS low_balance_threshold numeric;

        CREATE TABLE IF NOT EXISTS notifications (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type text NOT NULL,
            dedupe_key text NOT NULL,
            episode_key text,
            params jsonb NOT NULL DEFAULT '{}'::jsonb,
            show_in_app boolean NOT NULL DEFAULT true,
            email_status text NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'pending', 'sent', 'failed')),
            email_attempts integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            read_at timestamptz,
            resolved_at timestamptz,
            CONSTRAINT notifications_user_dedupe_key UNIQUE (user_id, dedupe_key)
        );
        CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS notifications_open_episode_idx ON notifications (user_id, episode_key) WHERE resolved_at IS NULL AND episode_key IS NOT NULL;
    `);
}

// MIGRATION SAFETY NOTE: down() drops the notifications table (the alert
// history and read state) and the accounts.low_balance_threshold column (every
// account's alert threshold). Neither can fail on existing rows.
export async function down(pgm) {
    pgm.sql(`
        DROP TABLE IF EXISTS notifications;
        ALTER TABLE accounts DROP COLUMN IF EXISTS low_balance_threshold;
    `);
}
